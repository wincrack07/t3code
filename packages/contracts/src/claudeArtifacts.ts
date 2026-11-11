import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ClaudeArtifactScope = Schema.Literals(["all", "mine", "shared"]);
export type ClaudeArtifactScope = typeof ClaudeArtifactScope.Type;

export const ClaudeArtifact = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  relation: Schema.Literals(["mine", "shared"]),
  isPublic: Schema.Boolean,
  viewCount: Schema.optional(NonNegativeInt),
  updatedAt: Schema.optional(Schema.String),
  ownerEmail: Schema.optional(Schema.String),
  // Signed, short-lived image URLs on claudeusercontent.com; they grant only that thumbnail.
  thumbnailUrl: Schema.optional(Schema.String),
  thumbnailDarkUrl: Schema.optional(Schema.String),
});
export type ClaudeArtifact = typeof ClaudeArtifact.Type;

export const ClaudeArtifactsListInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  scope: Schema.optional(ClaudeArtifactScope),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
  cursor: Schema.optional(Schema.String),
});
export type ClaudeArtifactsListInput = typeof ClaudeArtifactsListInput.Type;

export const ClaudeArtifactsListResult = Schema.Struct({
  artifacts: Schema.Array(ClaudeArtifact),
  nextCursor: Schema.optional(Schema.String),
  /** Claude returned its maximum page, so older artifacts may be missing. */
  truncated: Schema.Boolean,
});
export type ClaudeArtifactsListResult = typeof ClaudeArtifactsListResult.Type;

const CLAUDE_ARTIFACTS_FAILURES = {
  instanceNotFound: "This Claude account is not configured on this server.",
  notClaude: "Artifacts are only available for Claude accounts.",
  notSignedIn: "This Claude account is not signed in to claude.ai.",
  keychainUnsupported: "Artifacts cannot read a Claude login stored in the macOS Keychain yet.",
  loginExpired:
    "This Claude account's login has expired. Start a Claude turn with it, or run `claude`, to refresh it.",
  unavailable: "This Claude account does not have artifacts.",
  rateLimited: "Claude is rate limiting artifact requests. Try again soon.",
  requestFailed: "Claude could not list artifacts.",
} as const;

// No `cause`: the underlying HTTP error carries the request, and with it the account's bearer token.
export class ClaudeArtifactsError extends Schema.TaggedError<ClaudeArtifactsError>()(
  "ClaudeArtifactsError",
  {
    instanceId: ProviderInstanceId,
    reason: Schema.Literals(
      Object.keys(CLAUDE_ARTIFACTS_FAILURES) as Array<keyof typeof CLAUDE_ARTIFACTS_FAILURES>,
    ),
    status: Schema.optional(Schema.Int),
  },
) {
  override get message(): string {
    return CLAUDE_ARTIFACTS_FAILURES[this.reason];
  }
}
