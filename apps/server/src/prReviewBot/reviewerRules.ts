import type { ModelSelection, PrReviewRule } from "@t3tools/contracts";

export type AuthorProviderSource = "thread" | "trailer" | "unknown";

export interface AuthorProvider {
  readonly provider: string;
  readonly source: AuthorProviderSource;
}

// Names agents sign commits with, mapped to the driver kind T3 runs them as.
const TRAILER_PROVIDERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude|anthropic/i, "claudeAgent"],
  [/codex|openai|chatgpt/i, "codex"],
  [/cursor/i, "cursor"],
  [/grok|x\.ai|xai/i, "grok"],
  [/opencode/i, "opencode"],
  [/gemini|antigravity/i, "antigravity"],
  [/kiro/i, "kiro"],
];

const TRAILER = /^co-authored-by:\s*(.+)$/gim;

function providerFromCommitMessage(message: string): string | null {
  for (const match of message.matchAll(TRAILER)) {
    const signer = match[1] ?? "";
    const found = TRAILER_PROVIDERS.find(([pattern]) => pattern.test(signer));
    if (found) return found[1];
  }
  return null;
}

/**
 * Who wrote the change: the provider of a T3 thread that created or pushed it, else the most
 * common agent signed into its commits' `Co-Authored-By` trailers, else unknown.
 */
export function detectAuthorProvider(input: {
  readonly threadProviders: ReadonlyArray<string>;
  readonly commitMessages: ReadonlyArray<string>;
}): AuthorProvider {
  const fromThread = input.threadProviders.find((provider) => provider.trim() !== "");
  if (fromThread !== undefined) return { provider: fromThread, source: "thread" };
  const counts = new Map<string, number>();
  for (const message of input.commitMessages) {
    const provider = providerFromCommitMessage(message);
    if (provider !== null) counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  const top = [...counts].toSorted((left, right) => right[1] - left[1])[0];
  return top ? { provider: top[0], source: "trailer" } : { provider: "unknown", source: "unknown" };
}

/** The first rule for this author (or for `any`), else the default reviewer. */
export function selectReviewer(input: {
  readonly rules: ReadonlyArray<PrReviewRule>;
  readonly defaultReviewer: ModelSelection | null;
  readonly authorProvider: string;
}): { readonly reviewer: ModelSelection | null; readonly ruleIndex: number | null } {
  const author = input.authorProvider.toLowerCase();
  const index = input.rules.findIndex((rule) => {
    const match = rule.authorProvider.toLowerCase();
    return match === "any" || match === author;
  });
  return index === -1
    ? { reviewer: input.defaultReviewer, ruleIndex: null }
    : { reviewer: input.rules[index]!.reviewer, ruleIndex: index };
}
