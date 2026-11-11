/**
 * One reviewer per PR head across environments: each waits `priority × grace`, posts a claim
 * comment, and keeps it only if it is the earliest live one (GitHub comment ids are ordered).
 * A `done` claim blocks re-review of that head; an expired `active` one lets the next node in.
 */

export type ClaimState = "active" | "done" | "failed";

export interface Claim {
  readonly key: string;
  readonly environmentId: string;
  readonly state: ClaimState;
  readonly at: string;
}

export interface ClaimComment {
  readonly id: number;
  readonly body: string;
  /** Written by this bot's login or by someone with write access; anyone else's claim is ignored. */
  readonly trusted: boolean;
}

const CLAIM_PATTERN =
  /<!-- t3-review-claim key=(\S+) env=(\S+) state=(active|done|failed) at=(\S+) -->/;

export const formatClaimMarker = (claim: Claim) =>
  `<!-- t3-review-claim key=${claim.key} env=${claim.environmentId} state=${claim.state} at=${claim.at} -->`;

export function parseClaim(body: string): Claim | null {
  const match = CLAIM_PATTERN.exec(body);
  if (!match) return null;
  return { key: match[1]!, environmentId: match[2]!, state: match[3] as ClaimState, at: match[4]! };
}

/** The claim key for a full or incremental review of one head. */
export const headClaimKey = (headSha: string) => `sha-${headSha.toLowerCase()}`;

export type ClaimDecision =
  | { readonly kind: "free" }
  | { readonly kind: "done"; readonly commentId: number }
  | { readonly kind: "held"; readonly commentId: number; readonly environmentId: string };

export function decideClaim(input: {
  readonly key: string;
  readonly comments: ReadonlyArray<ClaimComment>;
  readonly nowMs: number;
  readonly leaseMs: number;
}): ClaimDecision {
  const claims = input.comments
    .filter((comment) => comment.trusted)
    .flatMap((comment) => {
      const claim = parseClaim(comment.body);
      return claim !== null && claim.key === input.key ? [{ comment, claim }] : [];
    })
    .toSorted((left, right) => left.comment.id - right.comment.id);
  const done = claims.find(({ claim }) => claim.state === "done");
  if (done) return { kind: "done", commentId: done.comment.id };
  const live = claims.find(({ claim }) => {
    if (claim.state !== "active") return false;
    const at = Date.parse(claim.at);
    return Number.isFinite(at) && input.nowMs - at < input.leaseMs;
  });
  return live
    ? { kind: "held", commentId: live.comment.id, environmentId: live.claim.environmentId }
    : { kind: "free" };
}

/** How long an environment waits for the ones ahead of it before it tries to claim. */
export const claimDelayMs = (priority: number, graceSeconds: number) =>
  Math.max(0, priority) * Math.max(0, graceSeconds) * 1_000;
