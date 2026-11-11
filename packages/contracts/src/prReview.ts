import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/** `owner/name`, lowercased by the server before it compares two of them. */
export const PrReviewRepositoryName = TrimmedString.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);

/**
 * Who wrote a pull request, as a provider driver kind (`codex`, `claudeAgent`, ...), `unknown`
 * when nothing says, or `any` in a rule that matches every author.
 */
export const PrReviewAuthorProvider = TrimmedString.check(Schema.isMinLength(1));

export const PrReviewRule = Schema.Struct({
  authorProvider: PrReviewAuthorProvider,
  reviewer: ModelSelection,
});
export type PrReviewRule = typeof PrReviewRule.Type;

export const PrReviewRepositoryConfig = Schema.Struct({
  repository: PrReviewRepositoryName,
  /** The project on this environment whose checkout holds the repository. */
  projectId: ProjectId,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Review every opened or updated pull request, not only when asked. */
  autoReview: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Replaces the global instructions for this repository when not empty. */
  instructions: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type PrReviewRepositoryConfig = typeof PrReviewRepositoryConfig.Type;

export const PrReviewIdentityMode = Schema.Literals(["github-app", "gh"]);
export type PrReviewIdentityMode = typeof PrReviewIdentityMode.Type;

export const PrReviewIdentityConfig = Schema.Struct({
  mode: PrReviewIdentityMode.pipe(Schema.withDecodingDefault(Effect.succeed("gh" as const))),
  appId: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  installationId: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** The app's URL name; its comments come from `<slug>[bot]`. */
  appSlug: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type PrReviewIdentityConfig = typeof PrReviewIdentityConfig.Type;

export const DEFAULT_PR_REVIEW_COMMAND = "@t3 review";

/**
 * Off until reviews are verified end to end: the server polls, claims and posts nothing, and
 * clients hide every way to start one. Settings can be prepared meanwhile.
 */
export const PR_REVIEW_EXECUTION_SHIPPED = false;

/** Stored per environment. The App private key is not here: it lives in the server's secret store. */
export const PrReviewConfig = Schema.Struct({
  /** This environment is a designated reviewer. Off, it polls nothing and claims nothing. */
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** 0 is the primary reviewer; a higher number waits longer before it claims a review. */
  priority: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** How long each priority step waits for a reviewer ahead of it to claim. */
  claimGraceSeconds: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(90))),
  identity: PrReviewIdentityConfig.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ mode: "gh" as const, appId: "", installationId: "", appSlug: "" }),
    ),
  ),
  command: TrimmedString.check(Schema.isMinLength(2)).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PR_REVIEW_COMMAND)),
  ),
  /** Review when the bot is requested as a reviewer (GitHub App identity only). */
  reviewOnRequest: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Logins allowed to ask for a review. Empty allows repository collaborators with write access. */
  allowedLogins: Schema.Array(TrimmedString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  instructions: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  repositories: Schema.Array(PrReviewRepositoryConfig).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** First match wins. */
  rules: Schema.Array(PrReviewRule).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Used when no rule matches; null uses the project's default model. */
  defaultReviewer: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type PrReviewConfig = typeof PrReviewConfig.Type;

export const PrReviewTrigger = Schema.Literals([
  "mention",
  "review-request",
  "auto",
  "manual",
  "follow-up",
]);
export type PrReviewTrigger = typeof PrReviewTrigger.Type;

export const PrReviewStatus = Schema.Literals([
  "waiting",
  "running",
  "posted",
  "failed",
  "skipped",
  "lost-claim",
]);
export type PrReviewStatus = typeof PrReviewStatus.Type;

export const PrReviewRecord = Schema.Struct({
  id: TrimmedString,
  repository: PrReviewRepositoryName,
  number: NonNegativeInt,
  headSha: TrimmedString,
  trigger: PrReviewTrigger,
  requestedBy: Schema.NullOr(TrimmedString),
  focus: TrimmedString,
  environmentId: EnvironmentId,
  threadId: Schema.NullOr(ThreadId),
  reviewer: Schema.NullOr(ModelSelection),
  authorProvider: PrReviewAuthorProvider,
  status: PrReviewStatus,
  detail: Schema.NullOr(TrimmedString),
  reviewUrl: Schema.NullOr(TrimmedString),
  /** Review comments this record posted; replies to them reach the same thread. */
  commentIds: Schema.Array(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  findingCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PrReviewRecord = typeof PrReviewRecord.Type;

export const PrReviewIdentityStatus = Schema.Struct({
  mode: PrReviewIdentityMode,
  ready: Schema.Boolean,
  login: Schema.NullOr(TrimmedString),
  hasPrivateKey: Schema.Boolean,
  detail: TrimmedString,
});
export type PrReviewIdentityStatus = typeof PrReviewIdentityStatus.Type;

export const PrReviewPollingStatus = Schema.Struct({
  lastPollAt: Schema.NullOr(IsoDateTime),
  backoffUntil: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(TrimmedString),
});

export const PrReviewState = Schema.Struct({
  config: PrReviewConfig,
  identity: PrReviewIdentityStatus,
  polling: PrReviewPollingStatus,
  history: Schema.Array(PrReviewRecord),
});
export type PrReviewState = typeof PrReviewState.Type;

export const PrReviewSetPrivateKeyInput = Schema.Struct({
  /** PEM text; empty removes the stored key. */
  privateKey: Schema.String,
});

export const PrReviewRequestInput = Schema.Struct({
  /** Review the pull request linked to this thread. */
  threadId: Schema.optionalKey(ThreadId),
  /** Or name it: `https://github.com/owner/name/pull/123`. */
  url: Schema.optionalKey(TrimmedString),
  focus: Schema.optionalKey(TrimmedString),
});
export type PrReviewRequestInput = typeof PrReviewRequestInput.Type;

export const PrReviewRerunInput = Schema.Struct({ recordId: TrimmedString });

export class PrReviewError extends Schema.TaggedError<PrReviewError>()("PrReviewError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
