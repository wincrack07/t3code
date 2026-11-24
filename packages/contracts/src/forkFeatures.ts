import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Features only this fork has. Each can be switched off per environment. */
const FORK_FEATURE_IDS = [
  "tasks",
  "prReviews",
  "chatHub",
  "chatBackup",
  "machineCleanup",
  "machineMonitor",
  "activityBoard",
  "decisions",
  "promptSuggestions",
  "promptPolish",
  "savedPrompts",
  "openQuestions",
  "agentStatusLine",
  "pinnedCards",
  "splitColumns",
  "moveThreads",
  "projectGroups",
  "claudeArtifacts",
  "mcpCatalog",
  "keepAwake",
  "sidebarColors",
  "sidebarLayout",
  "appearance",
  "multiWindow",
  "finderIntegration",
  "browserExtensions",
  "cliAccounts",
  "subagentAnswers",
  "updateCenter",
  "paletteFilters",
  "moveProjectFolder",
  "branding",
] as const;
export type ForkFeatureId = (typeof FORK_FEATURE_IDS)[number];

export const ForkFeatureSwitches = Schema.Struct({
  /** Every fork feature off at once, so the app behaves like official T3 Code. */
  officialMode: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // Plain strings: a newer fork build may have switched off a feature this one does not know.
  off: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ForkFeatureSwitches = typeof ForkFeatureSwitches.Type;

export const DEFAULT_FORK_FEATURE_SWITCHES: ForkFeatureSwitches = { officialMode: false, off: [] };

export const isForkFeatureOn = (
  switches: ForkFeatureSwitches | undefined,
  feature: ForkFeatureId,
): boolean => switches === undefined || (!switches.officialMode && !switches.off.includes(feature));
