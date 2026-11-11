import "@t3tools/client-runtime/assembly-highlighting";
import {
  getSharedHighlighter,
  setCustomExtension,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeNames } from "./diffRendering";

// Highlights has no lexer for these dialects, so they use their base language's.
setCustomExtension("luau", "lua");
setCustomExtension("xsl", "xml");
setCustomExtension("xslt", "xml");

/**
 * Highlights' hand-written WASM lexers tokenize large files 10-40x faster than
 * Shiki and never backtrack like Shiki's JS regex engine. Only one highlighter
 * type can be active per thread, so every creation site must pass this value.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "highlights";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const themes = resolveDiffThemeNames();
  // The shared highlighter is one instance; the key only tracks which themes it has loaded.
  const key = `${language}\u0000${themes.join("\u0000")}`;
  const cached = highlighterPromiseCache.get(key);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [...themes],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      highlighterPromiseCache.delete(key);
      throw error;
    }
    return getSyntaxHighlighterPromise("text");
  });
  highlighterPromiseCache.set(key, promise);
  return promise;
}
