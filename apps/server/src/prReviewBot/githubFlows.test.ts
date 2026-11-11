import { it } from "@effect/vitest";
import { PrReviewConfig, ProjectId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { claim, settleClaim } from "./claimFlow.ts";
import { headClaimKey } from "./claims.ts";
import {
  makeAppIdentity,
  verifiedLogin,
  type GitHubRequest,
  type GitHubResponse,
  type GitHubSend,
  type ReviewIdentity,
} from "./githubClient.ts";
import { makeGitHubReviewApi } from "./githubReviewApi.ts";
import { initialCursor, pollRepository } from "./poller.ts";

const BOT = "t3-review[bot]";
const decodeConfig = Schema.decodeSync(PrReviewConfig);
const REPO = "acme/app";

interface FakeComment {
  id: number;
  body: string;
  login: string;
  type?: string;
  number: number;
  updatedAt: string;
  inReplyTo?: number;
}

/** Just enough of GitHub's REST API for the claim and poll paths. */
function makeFakeGitHub(
  options: { readonly gateFirstListings?: Deferred.Deferred<void>; readonly etags?: boolean } = {},
) {
  const state = {
    nextId: 100,
    issueComments: [] as Array<FakeComment>,
    reviewComments: [] as Array<FakeComment>,
    pulls: [] as Array<{ number: number; sha: string; requested: Array<string>; draft?: boolean }>,
    permissions: { writer: "write", reader: "read", owner: "admin" } as Record<string, string>,
    calls: [] as Array<string>,
  };
  let gatedListings = 0;
  const json = (status: number, body: unknown, etag?: string): GitHubResponse => ({
    status,
    headers: etag === undefined ? {} : { etag },
    body: JSON.stringify(body),
  });
  const issueJson = (comment: FakeComment) => ({
    id: comment.id,
    body: comment.body,
    user: {
      login: comment.login,
      type: comment.type ?? (comment.login.endsWith("[bot]") ? "Bot" : "User"),
    },
    issue_url: `https://api.github.com/repos/${REPO}/issues/${comment.number}`,
    html_url: `https://github.com/${REPO}/pull/${comment.number}#issuecomment-${comment.id}`,
    updated_at: comment.updatedAt,
  });
  const listing = (body: unknown, request: GitHubRequest) => {
    const etag = `"${JSON.stringify(body).length}-${JSON.stringify(body)
      .split("")
      .reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)}"`;
    if (options.etags === false) return json(200, body);
    return request.etag === etag ? json(304, null) : json(200, body, etag);
  };
  const route = (request: GitHubRequest): GitHubResponse => {
    const method = request.method ?? "GET";
    const path = request.path.replace(`/repos/${REPO}`, "");
    state.calls.push(`${method} ${path}`);
    let match: RegExpExecArray | null;
    if (method === "GET" && (match = /^\/issues\/(\d+)\/comments/.exec(path))) {
      const number = Number(match[1]);
      return json(200, state.issueComments.filter((c) => c.number === number).map(issueJson));
    }
    if (method === "POST" && (match = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      const comment = {
        id: state.nextId++,
        body: (request.body as { body: string }).body,
        login: BOT,
        number: Number(match[1]),
        updatedAt: "2026-11-11T12:00:00Z",
      };
      state.issueComments.push(comment);
      return json(201, { id: comment.id, html_url: `https://github.com/x#${comment.id}` });
    }
    if ((match = /^\/issues\/comments\/(\d+)$/.exec(path))) {
      const id = Number(match[1]);
      if (method === "DELETE") {
        state.issueComments = state.issueComments.filter((c) => c.id !== id);
        return json(204, null);
      }
      const comment = state.issueComments.find((c) => c.id === id)!;
      comment.body = (request.body as { body: string }).body;
      return json(200, {});
    }
    if (method === "GET" && path.startsWith("/issues/comments?")) {
      return listing(state.issueComments.map(issueJson), request);
    }
    if (method === "GET" && path.startsWith("/pulls/comments?")) {
      return listing(
        state.reviewComments.map((comment) => ({
          ...issueJson(comment),
          issue_url: undefined,
          pull_request_url: `https://api.github.com/repos/${REPO}/pulls/${comment.number}`,
          ...(comment.inReplyTo === undefined ? {} : { in_reply_to_id: comment.inReplyTo }),
        })),
        request,
      );
    }
    if (method === "GET" && path.startsWith("/pulls?")) {
      return listing(
        state.pulls.map((pull) => ({
          number: pull.number,
          title: `PR ${pull.number}`,
          html_url: `https://github.com/${REPO}/pull/${pull.number}`,
          state: "open",
          draft: pull.draft ?? false,
          user: { login: "writer" },
          head: { ref: "feature", sha: pull.sha, repo: { full_name: REPO } },
          base: { ref: "main", sha: "base", repo: { full_name: REPO } },
          requested_reviewers: pull.requested.map((login) => ({ login })),
          updated_at: "2026-11-11T12:00:00Z",
        })),
        request,
      );
    }
    if (method === "GET" && (match = /^\/collaborators\/([^/]+)\/permission$/.exec(path))) {
      const permission = state.permissions[decodeURIComponent(match[1]!)];
      return permission === undefined ? json(404, {}) : json(200, { permission });
    }
    return json(500, { message: `unrouted ${method} ${path}` });
  };
  const send = (_token: string, request: GitHubRequest) =>
    Effect.gen(function* () {
      const gate = options.gateFirstListings;
      if (
        gate !== undefined &&
        /\/issues\/\d+\/comments$|\/issues\/\d+\/comments\?/.test(request.path) &&
        (request.method ?? "GET") === "GET" &&
        gatedListings < 2
      ) {
        gatedListings++;
        if (gatedListings === 2) yield* Deferred.succeed(gate, undefined);
        yield* Deferred.await(gate);
      }
      return route(request);
    });
  const identity: ReviewIdentity = {
    mode: "github-app",
    token: Effect.succeed("token"),
    login: Effect.succeed(BOT),
  };
  return { state, api: makeGitHubReviewApi(identity, send) };
}

const target = { repository: REPO, number: 7, key: headClaimKey("abc123") };
const now = Date.parse("2026-11-11T12:00:00Z");

describe("identity", () => {
  it.effect("is not ready until GitHub hands out an installation token", () =>
    Effect.gen(function* () {
      const { generateKeyPairSync } = yield* Effect.promise(() => import("node:crypto"));
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
      const answer =
        (status: number): GitHubSend =>
        () =>
          Effect.succeed({
            status,
            headers: {},
            body: JSON.stringify({ token: "t", expires_at: "2099-01-01T00:00:00Z" }),
          });
      const make = (status: number) =>
        makeAppIdentity({
          appId: "1",
          installationId: "2",
          appSlug: "t3-review",
          privateKey: pem,
          send: answer(status),
          nowMs: Effect.succeed(Date.parse("2026-11-11T12:00:00Z")),
        });
      const refused = yield* verifiedLogin(yield* make(401)).pipe(Effect.result);
      expect(refused._tag).toBe("Failure");
      expect(yield* verifiedLogin(yield* make(201))).toBe("t3-review[bot]");
    }),
  );
});

describe("single claimer", () => {
  it.effect("lets exactly one of two racing environments review a head", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const github = makeFakeGitHub({ gateFirstListings: gate });
      const attempt = (environmentId: string) =>
        claim({
          api: github.api,
          target,
          botLogin: BOT,
          environmentId,
          text: "Reviewing",
          nowMs: now,
        });
      const [first, second] = yield* Effect.all([attempt("env-a"), attempt("env-b")], {
        concurrency: "unbounded",
      });
      // Both read the pull request as free before either posted.
      expect([first.won, second.won].toSorted()).toEqual([false, true]);
      expect(github.state.issueComments).toHaveLength(1);
      const winner = first.won ? first : second;
      expect(winner.won && github.state.issueComments[0]!.id === winner.commentId).toBe(true);
    }),
  );

  it.effect("never claims a head that was reviewed, by this environment or another", () =>
    Effect.gen(function* () {
      const github = makeFakeGitHub();
      const won = yield* claim({
        api: github.api,
        target,
        botLogin: BOT,
        environmentId: "env-a",
        text: "Reviewing",
        nowMs: now,
      });
      expect(won.won).toBe(true);
      if (!won.won) return;
      yield* settleClaim({
        api: github.api,
        target,
        commentId: won.commentId,
        environmentId: "env-a",
        state: "done",
        text: "Reviewed",
        nowMs: now,
      });
      for (const environmentId of ["env-a", "env-b"]) {
        const again = yield* claim({
          api: github.api,
          target,
          botLogin: BOT,
          environmentId,
          text: "Reviewing",
          nowMs: now + 3_600_000,
        });
        expect(again).toEqual({ won: false, decision: { kind: "done", commentId: won.commentId } });
      }
      // A new head is a new key.
      const next = yield* claim({
        api: github.api,
        target: { ...target, key: headClaimKey("def456") },
        botLogin: BOT,
        environmentId: "env-b",
        text: "Reviewing",
        nowMs: now,
      });
      expect(next.won).toBe(true);
    }),
  );

  it.effect("ignores a claim forged by an account without write access", () =>
    Effect.gen(function* () {
      const github = makeFakeGitHub();
      github.state.issueComments.push({
        id: 1,
        number: 7,
        login: "reader",
        updatedAt: "2026-11-11T12:00:00Z",
        body: `<!-- t3-review-claim key=${target.key} env=x state=done at=2026-11-11T11:00:00Z -->`,
      });
      const result = yield* claim({
        api: github.api,
        target,
        botLogin: BOT,
        environmentId: "env-a",
        text: "Reviewing",
        nowMs: now,
      });
      expect(result.won).toBe(true);
    }),
  );
});

describe("polling", () => {
  const config = decodeConfig({ enabled: true });
  const repository = {
    repository: REPO,
    projectId: ProjectId.make("p"),
    enabled: true,
    autoReview: true,
    instructions: "",
  };
  const comment = (
    id: number,
    login: string,
    body: string,
    extra: Partial<FakeComment> = {},
  ): FakeComment => ({
    id,
    login,
    body,
    number: 7,
    updatedAt: "2026-11-11T12:00:00Z",
    ...extra,
  });

  it.effect("keeps requests from writers, drops everyone else, and revalidates with ETags", () =>
    Effect.gen(function* () {
      const github = makeFakeGitHub();
      github.state.pulls.push({ number: 7, sha: "abc", requested: [] });
      const poll = (
        cursor: Parameters<typeof pollRepository>[0]["cursor"],
        overrides: Partial<typeof config> = {},
      ) =>
        pollRepository({
          api: github.api,
          repository,
          config: { ...config, ...overrides },
          botLogin: BOT,
          cursor,
          isBotReviewComment: (id) => id === 900,
        });
      const baseline = yield* poll(initialCursor("2026-11-11T11:00:00Z"));
      expect(baseline.triggers).toEqual([]);

      github.state.issueComments.push(
        comment(1, "writer", "@t3 review the cache"),
        comment(2, "reader", "@t3 review"),
        comment(3, "stranger", "@t3 review"),
        comment(4, "renovate[bot]", "@t3 review"),
        comment(5, BOT, "@t3 review"),
        comment(6, "owner", "nice work"),
      );
      github.state.reviewComments.push(
        comment(7, "writer", "@t3 review is this really null-safe?", { inReplyTo: 900 }),
        comment(8, "writer", "@t3 review", { inReplyTo: 901 }),
      );
      github.state.pulls[0]!.sha = "def";
      const first = yield* poll(baseline.cursor);
      expect(first.triggers).toEqual([
        {
          kind: "mention",
          repository: REPO,
          number: 7,
          commentId: 1,
          requestedBy: "writer",
          focus: "the cache",
        },
        {
          kind: "follow-up",
          repository: REPO,
          number: 7,
          commentId: 7,
          rootCommentId: 900,
          requestedBy: "writer",
          question: "is this really null-safe?",
        },
        { kind: "auto", repository: REPO, number: 7, headSha: "def", requestedBy: "writer" },
      ]);

      const callsBefore = github.state.calls.length;
      const second = yield* poll(first.cursor);
      expect(second.triggers).toEqual([]);
      // Unchanged listings come back 304, so no permission lookups either.
      expect(github.state.calls.slice(callsBefore)).toHaveLength(3);

      const listed = yield* poll(initialCursor("2026-11-11T11:00:00Z"), {
        allowedLogins: ["reader"],
      });
      expect(
        listed.triggers
          .filter((t) => t.kind === "mention")
          .map((t) => t.kind === "mention" && t.commentId),
      ).toEqual([2]);
    }),
  );

  it.effect("auto-reviews a new head even when GitHub sends no ETag", () =>
    Effect.gen(function* () {
      const github = makeFakeGitHub({ etags: false });
      github.state.pulls.push({ number: 7, sha: "abc", requested: [] });
      const poll = (cursor: Parameters<typeof pollRepository>[0]["cursor"]) =>
        pollRepository({
          api: github.api,
          repository,
          config,
          botLogin: BOT,
          cursor,
          isBotReviewComment: () => false,
        });
      const baseline = yield* poll(initialCursor("2026-11-11T11:00:00Z"));
      expect(baseline.triggers).toEqual([]);
      github.state.pulls[0]!.sha = "def";
      github.state.pulls.push({ number: 8, sha: "new", requested: [] });
      const next = yield* poll(baseline.cursor);
      expect(
        next.triggers.map(
          (trigger) => trigger.kind === "auto" && [trigger.number, trigger.headSha],
        ),
      ).toEqual([
        [7, "def"],
        [8, "new"],
      ]);
    }),
  );

  it.effect("reviews a head once per review request naming the bot", () =>
    Effect.gen(function* () {
      const github = makeFakeGitHub();
      github.state.pulls.push({ number: 9, sha: "abc", requested: ["t3-review"] });
      const poll = (cursor: Parameters<typeof pollRepository>[0]["cursor"]) =>
        pollRepository({
          api: github.api,
          repository: { ...repository, autoReview: false },
          config,
          botLogin: BOT,
          cursor,
          isBotReviewComment: () => false,
        });
      const first = yield* poll(initialCursor("2026-11-11T11:00:00Z"));
      expect(first.triggers).toEqual([
        { kind: "review-request", repository: REPO, number: 9, headSha: "abc", requestedBy: null },
      ]);
      github.state.pulls.push({ number: 10, sha: "x", requested: [] });
      const second = yield* poll(first.cursor);
      expect(second.triggers).toEqual([]);
    }),
  );
});
