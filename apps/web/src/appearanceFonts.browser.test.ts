import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { applyAppearanceFontVariables } from "./appearanceFonts";

function renderedFontSize(style: (probe: HTMLElement) => void): string {
  const probe = document.createElement("div");
  style(probe);
  document.body.append(probe);
  try {
    return getComputedStyle(probe).fontSize;
  } finally {
    probe.remove();
  }
}

const composerFontSize = () =>
  renderedFontSize((probe) => {
    // The composer editor's own size class.
    probe.className = "text-(length:--font-size-prompt,var(--text-sm))";
  });

const touchComposerFontSize = () =>
  renderedFontSize((probe) => {
    probe.style.fontSize = "var(--font-size-prompt-touch)";
  });

describe("applyAppearanceFontVariables", () => {
  it("sizes the composer from the interface size until fonts are set separately", () => {
    const root = document.documentElement;
    const style = root.getAttribute("style");
    const theme = root.getAttribute("data-theme-id");
    const preferences = {
      sans: "",
      reply: "",
      sizeReply: null,
      code: "",
      composer: "",
      sizeInterface: 20,
      sizePrompt: 14,
      sizeCode: 13,
      smoothing: true,
    };
    try {
      applyAppearanceFontVariables(root, { ...preferences, separate: false });
      expect(composerFontSize()).toBe("17.5px");
      expect(touchComposerFontSize()).toBe("17.5px");

      applyAppearanceFontVariables(root, { ...preferences, separate: true });
      expect(composerFontSize()).toBe("14px");
      // iOS zooms into inputs under 16px.
      expect(touchComposerFontSize()).toBe("16px");

      root.dataset.themeId = "claude";
      expect(getComputedStyle(root).getPropertyValue("--font-reply")).toContain("Anthropic Serif");
      applyAppearanceFontVariables(root, {
        ...preferences,
        separate: false,
        reply: "Georgia",
        sizeReply: 18,
      });
      expect(root.style.getPropertyValue("--font-reply")).toBe("Georgia, var(--font-sans)");
      expect(root.style.getPropertyValue("--font-size-reply")).toBe("18px");
      applyAppearanceFontVariables(root, { ...preferences, separate: false });
      expect(root.style.getPropertyValue("--font-reply")).toBe("");
      expect(root.style.getPropertyValue("--font-size-reply")).toBe("");
    } finally {
      if (theme === null) root.removeAttribute("data-theme-id");
      else root.setAttribute("data-theme-id", theme);
      if (style === null) root.removeAttribute("style");
      else root.setAttribute("style", style);
    }
  });
});
