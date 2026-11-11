import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { decideClaim, formatClaimMarker, type ClaimDecision, type ClaimState } from "./claims.ts";
import type { PrReviewGitHubApi } from "./githubReviewApi.ts";
import { hasWritePermission } from "./triggers.ts";

/** A claim that has not finished in this long is treated as abandoned. */
const CLAIM_LEASE_MS = 45 * 60_000;

export interface ClaimTarget {
  readonly repository: string;
  readonly number: number;
  readonly key: string;
}

/** Claims, and comments that look like them, from this login or from accounts with write access. */
const readClaims = Effect.fn("PrReviewClaim.read")(function* (
  api: PrReviewGitHubApi,
  target: ClaimTarget,
  botLogin: string,
) {
  const comments = yield* api.listPullIssueComments(target.repository, target.number);
  const trustCache = new Map<string, boolean>();
  const trusted = Effect.fnUntraced(function* (login: string) {
    if (login.toLowerCase() === botLogin.toLowerCase()) return true;
    const cached = trustCache.get(login);
    if (cached !== undefined) return cached;
    const value = hasWritePermission(yield* api.permission(target.repository, login));
    trustCache.set(login, value);
    return value;
  });
  return yield* Effect.forEach(
    comments.filter((comment) => comment.body?.includes("<!-- t3-review-claim")),
    (comment) =>
      Effect.gen(function* () {
        return {
          id: comment.id,
          body: comment.body ?? "",
          trusted: comment.user === null ? false : yield* trusted(comment.user.login),
        };
      }),
  );
});

const inspectClaim = Effect.fn("PrReviewClaim.inspect")(function* (
  api: PrReviewGitHubApi,
  target: ClaimTarget,
  botLogin: string,
  nowMs: number,
) {
  const comments = yield* readClaims(api, target, botLogin);
  return decideClaim({ key: target.key, comments, nowMs, leaseMs: CLAIM_LEASE_MS });
});

export type ClaimResult =
  | { readonly won: true; readonly commentId: number }
  | { readonly won: false; readonly decision: Exclude<ClaimDecision, { kind: "free" }> };

/**
 * Posts this environment's claim and keeps it only if it is the earliest live one; see
 * `claims.ts`. A head already reviewed or held by another environment is not claimed at all.
 */
export const claim = Effect.fn("PrReviewClaim.claim")(function* (input: {
  readonly api: PrReviewGitHubApi;
  readonly target: ClaimTarget;
  readonly botLogin: string;
  readonly environmentId: string;
  readonly text: string;
  readonly nowMs: number;
}) {
  const before = yield* inspectClaim(input.api, input.target, input.botLogin, input.nowMs);
  if (before.kind !== "free") return { won: false, decision: before } satisfies ClaimResult;
  const marker = formatClaimMarker({
    key: input.target.key,
    environmentId: input.environmentId,
    state: "active",
    at: DateTime.formatIso(DateTime.makeUnsafe(input.nowMs)),
  });
  const created = yield* input.api.createIssueComment(
    input.target.repository,
    input.target.number,
    `${input.text}\n\n${marker}`,
  );
  const after = yield* inspectClaim(input.api, input.target, input.botLogin, input.nowMs);
  if (after.kind === "held" && after.commentId === created.id) {
    return { won: true, commentId: created.id } satisfies ClaimResult;
  }
  yield* input.api.deleteIssueComment(input.target.repository, created.id);
  return {
    won: false,
    decision: after.kind === "free" ? { kind: "held", commentId: -1, environmentId: "" } : after,
  } satisfies ClaimResult;
});

/** Rewrites a claim this environment holds; `done` marks the head reviewed for every environment. */
export const settleClaim = Effect.fn("PrReviewClaim.settle")(function* (input: {
  readonly api: PrReviewGitHubApi;
  readonly target: ClaimTarget;
  readonly commentId: number;
  readonly environmentId: string;
  readonly state: ClaimState;
  readonly text: string;
  readonly nowMs: number;
}) {
  yield* input.api.updateIssueComment(
    input.target.repository,
    input.commentId,
    `${input.text}\n\n${formatClaimMarker({
      key: input.target.key,
      environmentId: input.environmentId,
      state: input.state,
      at: DateTime.formatIso(DateTime.makeUnsafe(input.nowMs)),
    })}`,
  );
});
