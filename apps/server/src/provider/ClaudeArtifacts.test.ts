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

const withService = <A, E>(
  options: {
    readonly login?: string;
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
    if (options.login !== undefined) {
      yield* fs.writeFileString(path.join(directory, ".credentials.json"), options.login);
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
    return yield* use(service, requests);
  }).pipe(Effect.provideService(HostProcess.Platform, "linux"));

const LOGIN =
  '{"claudeAiOauth":{"accessToken":"work-token"},"mcpOAuth":{"x":{"accessToken":"other"}}}';

it.layer(NodeServices.layer)("ClaudeArtifacts.list", (it) => {
  it.effect("lists with the instance's own login, filters scope, pages, and caches", () =>
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
        expect(requests).toEqual([
          {
            url: "https://api.anthropic.com/api/frame/frames",
            authorization: "Bearer work-token",
          },
        ]);
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
});
