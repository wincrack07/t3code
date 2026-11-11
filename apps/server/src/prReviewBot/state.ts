import { PrReviewConfig, PrReviewRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ReviewTrigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("mention"),
    repository: Schema.String,
    number: Schema.Number,
    commentId: Schema.Number,
    requestedBy: Schema.String,
    focus: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literals(["review-request", "auto"]),
    repository: Schema.String,
    number: Schema.Number,
    headSha: Schema.String,
    requestedBy: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("follow-up"),
    repository: Schema.String,
    number: Schema.Number,
    commentId: Schema.Number,
    rootCommentId: Schema.Number,
    requestedBy: Schema.String,
    question: Schema.String,
  }),
]);
export type ReviewTrigger = typeof ReviewTrigger.Type;

export const RepositoryCursor = Schema.Struct({
  /** Kept until a newer comment arrives, so the same URL revalidates against its ETag. */
  issuesSince: Schema.String,
  reviewsSince: Schema.String,
  etags: Schema.Struct({
    issues: Schema.optionalKey(Schema.String),
    reviews: Schema.optionalKey(Schema.String),
    pulls: Schema.optionalKey(Schema.String),
  }),
  /** Comment ids already handled; `since` re-lists edited comments. */
  seenCommentIds: Schema.Array(Schema.Number),
  /** Open pull requests were listed once, so a head not seen before is new, not pre-existing. */
  pullsPrimed: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** The head each open pull request had at the last poll. */
  heads: Schema.Record(Schema.String, Schema.String),
  /** Heads the bot was asked to review by a review request. */
  requestedHeads: Schema.Record(Schema.String, Schema.String),
});
export type RepositoryCursor = typeof RepositoryCursor.Type;

export const PendingTrigger = Schema.Struct({
  trigger: ReviewTrigger,
  /** Epoch ms; a fallback environment waits for the ones ahead of it. */
  dueAt: Schema.Number,
});
export type PendingTrigger = typeof PendingTrigger.Type;

export const StoredPrReviewState = Schema.Struct({
  config: PrReviewConfig.pipe(
    Schema.withDecodingDefault(Effect.succeed(Schema.decodeSync(PrReviewConfig)({}))),
  ),
  history: Schema.Array(PrReviewRecord).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  cursors: Schema.Record(Schema.String, RepositoryCursor).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  pending: Schema.Array(PendingTrigger).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type StoredPrReviewState = typeof StoredPrReviewState.Type;
