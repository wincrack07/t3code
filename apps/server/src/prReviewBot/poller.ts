import type { PrReviewConfig, PrReviewRepositoryConfig } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { numberFromUrl, type PrReviewGitHubApi } from "./githubReviewApi.ts";
import type { RepositoryCursor, ReviewTrigger } from "./state.ts";
import { isAllowedRequester, isIgnoredAuthor, parseReviewCommand } from "./triggers.ts";

const MAX_SEEN = 500;
const SINCE_OVERLAP_MS = 60_000;

/** The newest update seen, less a minute for clock differences; unchanged when nothing is new. */
function advanceSince(
  since: string,
  items: ReadonlyArray<{ readonly updated_at: string }> | null,
): string {
  const newest = Math.max(...(items ?? []).map((item) => Date.parse(item.updated_at)));
  if (!Number.isFinite(newest)) return since;
  return DateTime.formatIso(
    DateTime.makeUnsafe(Math.max(Date.parse(since), newest - SINCE_OVERLAP_MS)),
  );
}

export const initialCursor = (nowIso: string): RepositoryCursor => ({
  issuesSince: nowIso,
  reviewsSince: nowIso,
  etags: {},
  seenCommentIds: [],
  heads: {},
  requestedHeads: {},
});

/**
 * One poll of one repository: new review requests from comments, replies to the bot's review
 * comments, review requests naming the bot, and new heads when auto-review is on. Comments from
 * the bot, other bots, and accounts that may not ask are dropped here.
 */
export const pollRepository = Effect.fn("PrReviewPoller.poll")(function* (input: {
  readonly api: PrReviewGitHubApi;
  readonly repository: PrReviewRepositoryConfig;
  readonly config: PrReviewConfig;
  readonly botLogin: string;
  readonly cursor: RepositoryCursor;
  /** Whether a review comment id is one the bot posted. */
  readonly isBotReviewComment: (commentId: number) => boolean;
}) {
  const repository = input.repository.repository;
  const seen = new Set(input.cursor.seenCommentIds);
  const fresh: Array<number> = [];
  const triggers: Array<ReviewTrigger> = [];
  const permissions = new Map<string, string | null>();
  const allowed = Effect.fnUntraced(function* (login: string) {
    if (input.config.allowedLogins.some((entry) => entry.trim() !== "")) {
      return isAllowedRequester({
        login,
        allowedLogins: input.config.allowedLogins,
        permission: null,
      });
    }
    if (!permissions.has(login)) {
      permissions.set(login, yield* input.api.permission(repository, login));
    }
    return isAllowedRequester({ login, allowedLogins: [], permission: permissions.get(login)! });
  });

  const issues = yield* input.api.listIssueComments(
    repository,
    input.cursor.issuesSince,
    input.cursor.etags.issues,
  );
  for (const comment of issues.items ?? []) {
    if (seen.has(comment.id)) continue;
    fresh.push(comment.id);
    const body = comment.body ?? "";
    if (isIgnoredAuthor(comment.user, body, input.botLogin)) continue;
    const request = parseReviewCommand(body, input.config.command);
    const number = numberFromUrl(comment.issue_url);
    if (request === null || number === null || !(yield* allowed(comment.user!.login))) continue;
    triggers.push({
      kind: "mention",
      repository,
      number,
      commentId: comment.id,
      requestedBy: comment.user!.login,
      focus: request.focus,
    });
  }

  const reviews = yield* input.api.listReviewComments(
    repository,
    input.cursor.reviewsSince,
    input.cursor.etags.reviews,
  );
  for (const comment of reviews.items ?? []) {
    if (seen.has(comment.id)) continue;
    fresh.push(comment.id);
    const body = comment.body ?? "";
    const root = comment.in_reply_to_id;
    if (root === undefined || !input.isBotReviewComment(root)) continue;
    if (isIgnoredAuthor(comment.user, body, input.botLogin)) continue;
    const request = parseReviewCommand(body, input.config.command);
    const number = numberFromUrl(comment.pull_request_url);
    if (request === null || number === null || !(yield* allowed(comment.user!.login))) continue;
    triggers.push({
      kind: "follow-up",
      repository,
      number,
      commentId: comment.id,
      rootCommentId: root,
      requestedBy: comment.user!.login,
      question: request.focus,
    });
  }

  const heads: Record<string, string> = { ...input.cursor.heads };
  const requestedHeads: Record<string, string> = { ...input.cursor.requestedHeads };
  const watchesPulls = input.repository.autoReview || input.config.reviewOnRequest;
  const pulls = watchesPulls
    ? yield* input.api.listOpenPulls(repository, input.cursor.etags.pulls)
    : { items: null, etag: input.cursor.etags.pulls };
  const firstPoll = input.cursor.etags.pulls === undefined;
  for (const pull of pulls.items ?? []) {
    const key = String(pull.number);
    const headSha = pull.head.sha;
    const requested = (pull.requested_reviewers ?? []).some(
      (reviewer) =>
        reviewer.login.toLowerCase() === input.botLogin.toLowerCase() ||
        `${reviewer.login}[bot]`.toLowerCase() === input.botLogin.toLowerCase(),
    );
    if (input.config.reviewOnRequest && requested && requestedHeads[key] !== headSha) {
      requestedHeads[key] = headSha;
      triggers.push({
        kind: "review-request",
        repository,
        number: pull.number,
        headSha,
        requestedBy: null,
      });
    } else if (
      input.repository.autoReview &&
      !firstPoll &&
      pull.draft !== true &&
      heads[key] !== headSha
    ) {
      triggers.push({
        kind: "auto",
        repository,
        number: pull.number,
        headSha,
        requestedBy: pull.user?.login ?? null,
      });
    }
    heads[key] = headSha;
  }

  const cursor: RepositoryCursor = {
    issuesSince: advanceSince(input.cursor.issuesSince, issues.items),
    reviewsSince: advanceSince(input.cursor.reviewsSince, reviews.items),
    etags: {
      ...(issues.etag === undefined ? {} : { issues: issues.etag }),
      ...(reviews.etag === undefined ? {} : { reviews: reviews.etag }),
      ...(pulls.etag === undefined ? {} : { pulls: pulls.etag }),
    },
    seenCommentIds: [...input.cursor.seenCommentIds, ...fresh].slice(-MAX_SEEN),
    heads,
    requestedHeads,
  };
  return { triggers, cursor };
});
