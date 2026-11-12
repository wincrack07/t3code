import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as ClaudeArtifacts from "./ClaudeArtifacts.ts";

const SLUG_A = "11111111-1111-4111-8111-111111111111";
const SLUG_B = "22222222-2222-4222-8222-222222222222";
const SLUG_C = "33333333-3333-4333-8333-333333333333";
const THUMB = `https://5613fc4a-1028-45ec-94d3-243e20b41ad1.frame.claudeusercontent.com/_f/1-ab/thumbnail.img?__frame_t=signed`;

// Shapes captured from a live /api/frame/frames listing, values replaced.
const FRAMES = [
  {
    slug: SLUG_A,
    owner_account: "acct",
    owner_email: "me@example.com",
    title: "  Older page ",
    description: "",
    rel: "mine",
    audience: "owner",
    thumbImgURL: THUMB,
    thumbDarkImgURL: "https://evil.example.com/x.img",
    updatedAt: "2026-11-01T10:00:00Z",
    created_at: "2026-10-01T10:00:00Z",
  },
  {
    slug: SLUG_B,
    owner_account: "other",
    owner_email: "friend@example.com",
    title: "Shared deck",
    rel: "shared",
    audience: "public",
    public_view_count: 12,
    created_at: "2026-11-05T10:00:00Z",
  },
  { slug: SLUG_C, title: "Deleted", rel: "mine", softDeleted: true },
  { slug: "not-a-slug", title: "Bad", rel: "mine" },
  { slug: SLUG_A, title: "Duplicate", rel: "mine" },
  { slug: "44444444-4444-4444-8444-444444444444", rel: "design" },
];

describe("parseClaudeArtifactFrames", () => {
  it("keeps readable rows newest first and drops deleted, malformed, and foreign thumbnails", () => {
    expect(ClaudeArtifacts.parseClaudeArtifactFrames(FRAMES)).toEqual([
      {
        id: SLUG_B,
        url: `https://claude.ai/code/artifact/${SLUG_B}`,
        title: "Shared deck",
        relation: "shared",
        isPublic: true,
        viewCount: 12,
        updatedAt: "2026-11-05T10:00:00Z",
        ownerEmail: "friend@example.com",
      },
      {
        id: SLUG_A,
        url: `https://claude.ai/code/artifact/${SLUG_A}`,
        title: "Older page",
        relation: "mine",
        isPublic: false,
        updatedAt: "2026-11-01T10:00:00Z",
        thumbnailUrl: THUMB,
      },
    ]);
  });

  it("maps HTTP statuses to account states", () => {
    expect(
      [200, 401, 403, 404, 429, 500].map(ClaudeArtifacts.claudeArtifactsFailureForStatus),
    ).toEqual([
      undefined,
      "loginExpired",
      "unavailable",
      "unavailable",
      "rateLimited",
      "requestFailed",
    ]);
  });
});

const WORK = ProviderInstanceId.make("claude_work");

const accountJson = (account: Record<string, string>) =>
  JSON.stringify({ userID: "random", oauthAccount: account });
const WORK_ACCOUNT = {
  accountUuid: "acct-1",
  organizationUuid: "org-work",
  organizationName: "Work Org",
  emailAddress: "me@example.com",
};

describe("claudeAccountIdentity", () => {
  it("keys an account by its account and organization ids, not its e-mail", () => {
    const work = ClaudeArtifacts.claudeAccountIdentity(accountJson(WORK_ACCOUNT));
    const personal = ClaudeArtifacts.claudeAccountIdentity(
      accountJson({ ...WORK_ACCOUNT, organizationUuid: "org-personal", organizationName: "Mine" }),
    );
    const sameElsewhere = ClaudeArtifacts.claudeAccountIdentity(
      accountJson({ ...WORK_ACCOUNT, emailAddress: "renamed@example.com" }),
    );
    expect(work).toEqual({
      accountKey: expect.stringMatching(/^[0-9a-f]{32}$/),
      organizationName: "Work Org",
      email: "me@example.com",
    });
    expect(personal.accountKey).not.toBe(work.accountKey);
    expect(sameElsewhere.accountKey).toBe(work.accountKey);
    expect(work.accountKey).not.toContain("acct-1");
  });

  it("has no key when signed out or unreadable", () => {
    expect(ClaudeArtifacts.claudeAccountIdentity('{"userID":"x"}')).toEqual({});
    expect(ClaudeArtifacts.claudeAccountIdentity("not json")).toEqual({});
    expect(
      ClaudeArtifacts.claudeAccountIdentity(accountJson({ emailAddress: "me@example.com" })),
    ).toEqual({ email: "me@example.com" });
  });
});

const withService = <A, E>(
  options: {
    readonly login?: string;
    readonly account?: string;
    readonly homeAccount?: string;
    readonly respond?: (request: { readonly url: string; readonly headers: object }) => Response;
  },
  use: (
    service: ClaudeArtifacts.ClaudeArtifacts["Service"],
    requests: Array<{ readonly url: string; readonly authorization: string | undefined }>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped();
    const home = yield* fs.makeTempDirectoryScoped();
    if (options.login !== undefined) {
      yield* fs.writeFileString(path.join(directory, ".credentials.json"), options.login);
    }
    if (options.account !== undefined) {
      yield* fs.writeFileString(path.join(directory, ".claude.json"), options.account);
    }
    if (options.homeAccount !== undefined) {
      yield* fs.writeFileString(path.join(home, ".claude.json"), options.homeAccount);
    }
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const client = HttpClient.make((request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      const response =
        options.respond?.({ url: request.url, headers: request.headers }) ??
        Response.json({ frames: FRAMES });
      return Effect.succeed(HttpClientResponse.fromWeb(request, response));
    });
    const service = yield* ClaudeArtifacts.ClaudeArtifacts.pipe(
      Effect.provide(
        ClaudeArtifacts.layer.pipe(
          Layer.provide(
            ServerSettings.layerTest({
              providerInstances: {
                [WORK]: {
                  driver: ProviderDriverKind.make("claudeAgent"),
                  config: { homePath: directory },
                },
                [ProviderInstanceId.make("codex_work")]: {
                  driver: ProviderDriverKind.make("codex"),
                },
              },
            }),
          ),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
        ),
      ),
    );
    return yield* use(service, requests).pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
    );
  }).pipe(
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Environment, {}),
  );

const LOGIN =
  '{"claudeAiOauth":{"accessToken":"work-token"},"mcpOAuth":{"x":{"accessToken":"other"}}}';

it.layer(NodeServices.layer)("ClaudeArtifacts.list", (it) => {
  it.effect(
    "lists with the instance's own login, filters scope, pages, caches, and refreshes on request",
    () =>
      withService({ login: LOGIN }, (service, requests) =>
        Effect.gen(function* () {
          const mine = yield* service.list({ instanceId: WORK, scope: "mine" });
          expect(mine.artifacts.map((artifact) => artifact.id)).toEqual([SLUG_A]);
          const firstPage = yield* service.list({ instanceId: WORK, limit: 1 });
          expect(firstPage.artifacts.map((artifact) => artifact.id)).toEqual([SLUG_B]);
          expect(firstPage.nextCursor).toBe("1");
          const secondPage = yield* service.list({ instanceId: WORK, limit: 1, cursor: "1" });
          expect(secondPage.artifacts.map((artifact) => artifact.id)).toEqual([SLUG_A]);
          expect(secondPage.nextCursor).toBeUndefined();
          expect(secondPage.truncated).toBe(false);
          const request = {
            url: "https://api.anthropic.com/api/frame/frames",
            authorization: "Bearer work-token",
          };
          expect(requests).toEqual([request]);
          yield* service.list({ instanceId: WORK, refresh: true });
          expect(requests).toEqual([request, request]);
        }),
      ),
  );

  it.effect("reports account states without sending a request it cannot authorize", () =>
    Effect.gen(function* () {
      const reasonOf = (input: Parameters<typeof withService>[0], instanceId = WORK) =>
        withService(input, (service, requests) =>
          service.list({ instanceId }).pipe(
            Effect.flip,
            Effect.map((error) => ({ reason: error.reason, requests: requests.length })),
          ),
        );
      expect(yield* reasonOf({})).toEqual({ reason: "notSignedIn", requests: 0 });
      expect(yield* reasonOf({ login: '{"claudeAiOauth":{}}' })).toEqual({
        reason: "notSignedIn",
        requests: 0,
      });
      expect(yield* reasonOf({ login: LOGIN }, ProviderInstanceId.make("codex_work"))).toEqual({
        reason: "notClaude",
        requests: 0,
      });
      expect(yield* reasonOf({ login: LOGIN }, ProviderInstanceId.make("missing"))).toEqual({
        reason: "instanceNotFound",
        requests: 0,
      });
      expect(
        yield* reasonOf({
          login: LOGIN,
          respond: () => new Response("artifacts disabled", { status: 403 }),
        }),
      ).toEqual({ reason: "unavailable", requests: 1 });
      expect(
        yield* reasonOf({ login: LOGIN, respond: () => Response.json({ nope: true }) }),
      ).toEqual({ reason: "requestFailed", requests: 1 });
    }),
  );
  it.effect("describes each Claude instance without network requests or tokens", () =>
    withService(
      {
        login: LOGIN,
        account: accountJson(WORK_ACCOUNT),
        homeAccount: accountJson({ ...WORK_ACCOUNT, organizationUuid: "org-personal" }),
      },
      (service, requests) =>
        Effect.gen(function* () {
          const { accounts } = yield* service.accounts;
          expect(accounts).toEqual([
            {
              instanceId: WORK,
              accountKey: expect.any(String),
              organizationName: "Work Org",
              email: "me@example.com",
              listable: true,
            },
            {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              accountKey: expect.any(String),
              organizationName: "Work Org",
              email: "me@example.com",
              listable: false,
            },
          ]);
          expect(accounts[0]?.accountKey).not.toBe(accounts[1]?.accountKey);
          expect(JSON.stringify(accounts)).not.toContain("work-token");
          expect(requests).toEqual([]);
        }),
    ),
  );
});
