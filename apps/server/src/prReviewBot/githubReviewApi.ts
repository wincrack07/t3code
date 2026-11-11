import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  call,
  GitHubCallError,
  type GitHubRequest,
  type GitHubSend,
  type ReviewIdentity,
} from "./githubClient.ts";
import type { GitHubReviewComment } from "./reviewFindings.ts";

const User = Schema.NullOr(
  Schema.Struct({ login: Schema.String, type: Schema.optional(Schema.String) }),
);

const IssueComment = Schema.Struct({
  id: Schema.Number,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  user: User,
  issue_url: Schema.String,
  html_url: Schema.String,
  updated_at: Schema.String,
});
export type IssueComment = typeof IssueComment.Type;

const ReviewComment = Schema.Struct({
  id: Schema.Number,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  user: User,
  pull_request_url: Schema.String,
  in_reply_to_id: Schema.optional(Schema.Number),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  diff_hunk: Schema.optional(Schema.String),
  html_url: Schema.String,
  updated_at: Schema.String,
});
export type ReviewComment = typeof ReviewComment.Type;

const Ref = Schema.Struct({
  ref: Schema.String,
  sha: Schema.String,
  repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
});

const Pull = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  user: User,
  head: Ref,
  base: Ref,
  requested_reviewers: Schema.optional(Schema.Array(Schema.Struct({ login: Schema.String }))),
  updated_at: Schema.String,
});
export type Pull = typeof Pull.Type;

const PullFile = Schema.Struct({ filename: Schema.String, patch: Schema.optional(Schema.String) });
const Commit = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({ message: Schema.String }),
});
const Permission = Schema.Struct({ permission: Schema.String });
const Created = Schema.Struct({ id: Schema.Number, html_url: Schema.String });

const decode = <S extends Schema.Top>(schema: S, operation: string, body: string) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
    Effect.mapError(
      () =>
        new GitHubCallError({
          operation,
          status: 200,
          detail: "GitHub answered in an unknown shape.",
        }),
    ),
  );

/** A listing read with an ETag; `items` is null when GitHub answered 304. */
export interface ConditionalPage<A> {
  readonly items: ReadonlyArray<A> | null;
  readonly etag: string | undefined;
}

export type PrReviewGitHubApi = ReturnType<typeof makeGitHubReviewApi>;

const repoPath = (repository: string) =>
  `/repos/${repository
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

/** The pull request number an issue or review comment belongs to. */
export const numberFromUrl = (url: string) => {
  const match = /\/(?:issues|pulls)\/(\d+)(?:$|[/?#])/.exec(url);
  return match ? Number(match[1]) : null;
};

export function makeGitHubReviewApi(identity: ReviewIdentity, send: GitHubSend) {
  const get = <S extends Schema.Top>(schema: S, operation: string, request: GitHubRequest) =>
    call(identity, send, operation, request).pipe(
      Effect.flatMap((response) => decode(schema, operation, response.body)),
    );
  const conditional = <S extends Schema.Top>(
    schema: S,
    operation: string,
    request: GitHubRequest,
  ) =>
    call(identity, send, operation, request).pipe(
      Effect.flatMap((response) =>
        response.status === 304
          ? Effect.succeed({ items: null, etag: request.etag })
          : decode(Schema.Array(schema), operation, response.body).pipe(
              Effect.map((items): ConditionalPage<S["Type"]> => ({
                items,
                etag: response.headers["etag"],
              })),
            ),
      ),
    );
  /** Up to `maxPages` pages of 100. */
  const all = Effect.fn("PrReviewGitHub.all")(function* <S extends Schema.Top>(
    schema: S,
    operation: string,
    path: string,
    maxPages = 10,
  ) {
    const items: Array<S["Type"]> = [];
    for (let page = 1; page <= maxPages; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = yield* get(Schema.Array(schema), operation, {
        path: `${path}${separator}per_page=100&page=${page}`,
      });
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items;
  });

  return {
    identity,
    /** Every issue and pull request comment in the repository updated since `since`. */
    listIssueComments: (repository: string, since: string, etag?: string) =>
      conditional(IssueComment, "listIssueComments", {
        path: `${repoPath(repository)}/issues/comments?sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`,
        etag,
      }),
    listReviewComments: (repository: string, since: string, etag?: string) =>
      conditional(ReviewComment, "listReviewComments", {
        path: `${repoPath(repository)}/pulls/comments?sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`,
        etag,
      }),
    listOpenPulls: (repository: string, etag?: string) =>
      conditional(Pull, "listOpenPulls", {
        path: `${repoPath(repository)}/pulls?state=open&sort=updated&direction=desc&per_page=30`,
        etag,
      }),
    getPull: (repository: string, number: number) =>
      get(Pull, "getPull", { path: `${repoPath(repository)}/pulls/${number}` }),
    /** Null when the number is an issue, not a pull request. */
    findPull: (repository: string, number: number) =>
      call(
        identity,
        send,
        "getPull",
        { path: `${repoPath(repository)}/pulls/${number}` },
        [200, 404],
      ).pipe(
        Effect.flatMap((response) =>
          response.status === 404 ? Effect.succeed(null) : decode(Pull, "getPull", response.body),
        ),
      ),
    listPullFiles: (repository: string, number: number) =>
      all(PullFile, "listPullFiles", `${repoPath(repository)}/pulls/${number}/files`, 30),
    listPullCommits: (repository: string, number: number) =>
      all(Commit, "listPullCommits", `${repoPath(repository)}/pulls/${number}/commits`, 3),
    listPullIssueComments: (repository: string, number: number) =>
      all(
        IssueComment,
        "listPullIssueComments",
        `${repoPath(repository)}/issues/${number}/comments`,
      ),
    getReviewComment: (repository: string, id: number) =>
      get(ReviewComment, "getReviewComment", {
        path: `${repoPath(repository)}/pulls/comments/${id}`,
      }),
    /** GitHub's permission name for `login`, or null when it is not a collaborator. */
    permission: (repository: string, login: string) =>
      call(
        identity,
        send,
        "permission",
        { path: `${repoPath(repository)}/collaborators/${encodeURIComponent(login)}/permission` },
        [200, 403, 404],
      ).pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? decode(Permission, "permission", response.body).pipe(
                Effect.map(({ permission }) => permission),
              )
            : Effect.succeed(null),
        ),
      ),
    createIssueComment: (repository: string, number: number, body: string) =>
      call(identity, send, "createIssueComment", {
        method: "POST",
        path: `${repoPath(repository)}/issues/${number}/comments`,
        body: { body },
      }).pipe(Effect.flatMap((response) => decode(Created, "createIssueComment", response.body))),
    updateIssueComment: (repository: string, id: number, body: string) =>
      call(identity, send, "updateIssueComment", {
        method: "PATCH",
        path: `${repoPath(repository)}/issues/comments/${id}`,
        body: { body },
      }).pipe(Effect.asVoid),
    deleteIssueComment: (repository: string, id: number) =>
      call(
        identity,
        send,
        "deleteIssueComment",
        { method: "DELETE", path: `${repoPath(repository)}/issues/comments/${id}` },
        [204, 404],
      ).pipe(Effect.asVoid),
    react: (repository: string, target: "issue" | "review", id: number, content: string) =>
      call(identity, send, "react", {
        method: "POST",
        path: `${repoPath(repository)}/${target === "issue" ? "issues" : "pulls"}/comments/${id}/reactions`,
        body: { content },
      }).pipe(Effect.asVoid),
    /** Always `COMMENT`: the bot never approves or blocks a merge. */
    createReview: (
      repository: string,
      number: number,
      input: {
        readonly commitId: string;
        readonly body: string;
        readonly comments: ReadonlyArray<GitHubReviewComment>;
      },
    ) =>
      call(identity, send, "createReview", {
        method: "POST",
        path: `${repoPath(repository)}/pulls/${number}/reviews`,
        body: {
          commit_id: input.commitId,
          body: input.body,
          event: "COMMENT",
          comments: input.comments,
        },
      }).pipe(Effect.flatMap((response) => decode(Created, "createReview", response.body))),
    listReviewCommentIds: (repository: string, number: number, reviewId: number) =>
      all(
        Schema.Struct({ id: Schema.Number }),
        "listReviewCommentIds",
        `${repoPath(repository)}/pulls/${number}/reviews/${reviewId}/comments`,
        3,
      ).pipe(Effect.map((items) => items.map((item) => item.id))),
    replyToReviewComment: (repository: string, number: number, commentId: number, body: string) =>
      call(identity, send, "replyToReviewComment", {
        method: "POST",
        path: `${repoPath(repository)}/pulls/${number}/comments/${commentId}/replies`,
        body: { body },
      }).pipe(Effect.flatMap((response) => decode(Created, "replyToReviewComment", response.body))),
  };
}
