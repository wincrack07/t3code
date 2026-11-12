/** Return append-only text, discarding model echoes and rewrites of the draft. */
export function promptContinuation(draft: string, suggestion: string): string | null {
  if (draft.length === 0) return suggestion;
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
  const prefix = normalize(draft).replace(/[\p{P}\s]+$/gu, "");
  const ends: Array<number> = [];
  let normalized = "";
  let offset = 0;
  for (const character of suggestion) {
    offset += character.length;
    const folded = character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const unit of folded) {
      if (/\s/u.test(unit)) {
        if (normalized.length === 0 || normalized.endsWith(" ")) continue;
        normalized += " ";
      } else {
        normalized += unit;
      }
      for (let index = 0; index < unit.length; index++) ends.push(offset);
    }
  }
  const suggestedPrefix = normalized.trimEnd().replace(/[\p{P}\s]+$/gu, "");
  if (suggestedPrefix.length > 0 && prefix.startsWith(suggestedPrefix)) return null;
  let continuation = suggestion;
  if (prefix.length > 0 && normalized.startsWith(prefix)) {
    let end = ends[prefix.length - 1]!;
    while (end < suggestion.length && /\p{M}/u.test(suggestion[end]!)) end++;
    if (/\p{P}$/u.test(draft.trimEnd())) {
      while (end < suggestion.length && /\p{P}/u.test(suggestion[end]!)) end++;
    }
    continuation = suggestion.slice(end);
    if (/\s$/u.test(draft)) continuation = continuation.trimStart();
  } else {
    const words = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
    const draftWords = words(draft);
    const suggestedWords = words(suggestion);
    const draftVocabulary = new Set(draftWords);
    const common = suggestedWords.filter((word) => draftVocabulary.has(word)).length;
    if (
      draftWords.length > 0 &&
      suggestedWords.length > 0 &&
      common / draftWords.length >= 0.7 &&
      common / suggestedWords.length >= 0.7
    )
      return null;
  }
  return /[\p{L}\p{N}]/u.test(continuation) ? continuation : null;
}
