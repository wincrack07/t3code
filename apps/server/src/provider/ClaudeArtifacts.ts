import {
  ClaudeArtifactsError,
  ClaudeSettings,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type ClaudeArtifact,
  type ClaudeArtifactsAccount,
  type ClaudeArtifactsAccountsResult,
  type ClaudeArtifactsListInput,
  type ClaudeArtifactsListResult,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
// A plain sha256 hex digest; the account key only needs to be stable and opaque.
import { hashTelemetryId as sha256Hex } from "@t3tools/shared/telemetryId";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { mergeClaudeProcessEnvironment, resolveClaudeHomePath } from "./Drivers/ClaudeHome.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
// The installed Claude Code CLI lists artifacts with this same request (its Artifact tool's
// `list` action). It is not a documented API; Claude returns at most FRAME_LIMIT rows, unpaged.
const FRAMES_URL = "https://api.anthropic.com/api/frame/frames";
const FRAME_LIMIT = 200;
const ARTIFACT_URL = "https://claude.ai/code/artifact/";
const SLUG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THUMBNAIL_HOST = /^[0-9a-z-]+\.frame\.claudeusercontent\.com$/;
const DEFAULT_PAGE_SIZE = 60;

const Credentials = Schema.Struct({
  claudeAiOauth: Schema.optional(Schema.Struct({ accessToken: Schema.optional(Schema.String) })),
});
const decodeCredentials = Schema.decodeUnknownEffect(Schema.fromJsonString(Credentials));
const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

// Claude Code keeps the signed-in account beside its settings; ids only, no secrets.
const AccountConfig = Schema.Struct({
  oauthAccount: Schema.optional(
    Schema.Struct({
      accountUuid: Schema.optional(Schema.String),
      organizationUuid: Schema.optional(Schema.String),
      organizationName: Schema.optional(Schema.String),
      emailAddress: Schema.optional(Schema.String),
    }),
  ),
});
const decodeAccountConfig = Schema.decodeUnknownOption(Schema.fromJsonString(AccountConfig));

export interface ClaudeAccountIdentity {
  readonly accountKey?: string;
  readonly organizationName?: string;
  readonly email?: string;
}

/** Derives a stable, opaque account key from Claude Code's `.claude.json`; `{}` when signed out. */
export function claudeAccountIdentity(configJson: string): ClaudeAccountIdentity {
  const account = Option.getOrUndefined(decodeAccountConfig(configJson))?.oauthAccount;
  const accountId = account?.accountUuid?.trim();
  const organizationId = account?.organizationUuid?.trim() ?? "";
  const organizationName = account?.organizationName?.trim();
  const email = account?.emailAddress?.trim();
  return {
    ...(accountId
      ? {
          accountKey: sha256Hex(`claude-account\0${accountId}\0${organizationId}`).slice(0, 32),
        }
      : {}),
    ...(organizationName ? { organizationName } : {}),
    ...(email ? { email } : {}),
  };
}

// Only the identity fields are required; the rest are read leniently, like the CLI does.
const FrameRow = Schema.Struct({
  slug: Schema.String.check(Schema.isPattern(SLUG)),
  rel: Schema.Literals(["mine", "shared"]),
});
const decodeFrameRow = Schema.decodeUnknownOption(FrameRow);
const FramesResponse = Schema.Struct({
  frames: Schema.NullOr(Schema.Array(Schema.Unknown)),
});

const text = (row: Record<string, unknown>, key: string): string | undefined => {
  const value = row[key];
  return typeof value === "string" ? value.trim() || undefined : undefined;
};

const thumbnail = (row: Record<string, unknown>, key: string): string | undefined => {
  const url = URL.parse(text(row, key) ?? "");
  return url?.protocol === "https:" && THUMBNAIL_HOST.test(url.hostname) ? url.href : undefined;
};

/** Turns Claude's frame listing into gallery rows, newest first. Unreadable rows are dropped. */
export function parseClaudeArtifactFrames(frames: ReadonlyArray<unknown>): ClaudeArtifact[] {
  const seen = new Set<string>();
  const artifacts: ClaudeArtifact[] = [];
  for (const raw of frames) {
    const row = decodeFrameRow(raw);
    if (Option.isNone(row) || seen.has(row.value.slug)) continue;
    const fields = raw as Record<string, unknown>;
    if (fields.softDeleted === true) continue;
    const { slug, rel } = row.value;
    seen.add(slug);
    const description = text(fields, "description");
    const updatedAt = text(fields, "updatedAt") ?? text(fields, "created_at");
    const ownerEmail = rel === "shared" ? text(fields, "owner_email") : undefined;
    const thumbnailUrl = thumbnail(fields, "thumbImgURL");
    const thumbnailDarkUrl = thumbnail(fields, "thumbDarkImgURL");
    const viewCount = fields.public_view_count;
    artifacts.push({
      id: slug,
      url: `${ARTIFACT_URL}${slug}`,
      title: text(fields, "title") ?? "Untitled",
      relation: rel,
      isPublic: fields.audience === "public",
      ...(description ? { description } : {}),
      ...(Number.isSafeInteger(viewCount) && (viewCount as number) >= 0
        ? { viewCount: viewCount as number }
        : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(thumbnailDarkUrl ? { thumbnailDarkUrl } : {}),
    });
  }
  const time = (artifact: ClaudeArtifact) => Date.parse(artifact.updatedAt ?? "") || 0;
  return artifacts.sort((left, right) => time(right) - time(left));
}

export const claudeArtifactsFailureForStatus = (
  status: number,
): ClaudeArtifactsError["reason"] | undefined => {
  if (status >= 200 && status < 300) return undefined;
  if (status === 401) return "loginExpired";
  if (status === 403 || status === 404) return "unavailable";
  if (status === 429) return "rateLimited";
  return "requestFailed";
};

interface Listing {
  readonly artifacts: ReadonlyArray<ClaudeArtifact>;
  readonly truncated: boolean;
}

export class ClaudeArtifacts extends Context.Service<
  ClaudeArtifacts,
  {
    readonly list: (
      input: ClaudeArtifactsListInput,
    ) => Effect.Effect<ClaudeArtifactsListResult, ClaudeArtifactsError>;
    readonly accounts: Effect.Effect<ClaudeArtifactsAccountsResult>;
  }
>()("t3/provider/ClaudeArtifacts") {}

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const hostEnvironment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;

  const resolveConfigDir = Effect.fn("ClaudeArtifacts.resolveConfigDir")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const fail = (reason: ClaudeArtifactsError["reason"]) =>
      new ClaudeArtifactsError({ instanceId, reason });
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() => fail("requestFailed")),
    );
    return yield* resolveInstanceHome(settings.providerInstances, instanceId);
  });

  const resolveInstanceHome = Effect.fn("ClaudeArtifacts.resolveInstanceHome")(function* (
    providerInstances: Record<string, ProviderInstanceConfig>,
    instanceId: ProviderInstanceId,
  ) {
    const fail = (reason: ClaudeArtifactsError["reason"]) =>
      new ClaudeArtifactsError({ instanceId, reason });
    const configured: ProviderInstanceConfig | undefined = Object.hasOwn(
      providerInstances,
      instanceId,
    )
      ? providerInstances[instanceId]
      : instanceId === defaultInstanceIdForDriver(CLAUDE_DRIVER)
        ? { driver: CLAUDE_DRIVER }
        : undefined;
    if (configured === undefined || !resolveProviderInstanceEnabled(configured)) {
      return yield* fail("instanceNotFound");
    }
    if (configured.driver !== CLAUDE_DRIVER) return yield* fail("notClaude");
    const config = decodeClaudeSettings(configured.config ?? {});
    if (Option.isNone(config)) return yield* fail("instanceNotFound");
    const environment = yield* mergeClaudeProcessEnvironment(
      config.value,
      configured.environment,
      hostEnvironment,
    );
    const configDir = yield* resolveClaudeHomePath(config.value, environment);
    // Claude Code keeps `.claude.json` in the config dir only when one is chosen explicitly.
    const explicit = config.value.homePath.trim() || environment.CLAUDE_CONFIG_DIR?.trim();
    const home = yield* HostProcess.HomeDirectory;
    return {
      configDir,
      accountConfigPath: explicit
        ? path.join(configDir, ".claude.json")
        : path.join(home, ".claude.json"),
    };
  });

  // Reads only the access token, only from this instance's own login file, and never refreshes it:
  // refreshing rotates the refresh token, which would sign the CLI out unless written back.
  const readAccessToken = Effect.fn("ClaudeArtifacts.readAccessToken")(function* (
    instanceId: ProviderInstanceId,
    configDir: string,
  ) {
    if (platform === "darwin") {
      return yield* new ClaudeArtifactsError({ instanceId, reason: "keychainUnsupported" });
    }
    const credentials = yield* fileSystem
      .readFileString(path.join(configDir, ".credentials.json"))
      .pipe(
        Effect.flatMap(decodeCredentials),
        Effect.mapError(() => new ClaudeArtifactsError({ instanceId, reason: "notSignedIn" })),
      );
    const token = credentials.claudeAiOauth?.accessToken?.trim();
    if (!token) return yield* new ClaudeArtifactsError({ instanceId, reason: "notSignedIn" });
    return token;
  });

  const fetchListing = Effect.fn("ClaudeArtifacts.fetchListing")(
    function* (instanceId: ProviderInstanceId) {
      const { configDir } = yield* resolveConfigDir(instanceId);
      const token = yield* readAccessToken(instanceId, configDir);
      const requestFailed = (status?: number) =>
        new ClaudeArtifactsError({
          instanceId,
          reason: "requestFailed",
          ...(status === undefined ? {} : { status }),
        });
      const response = yield* httpClient
        .execute(
          HttpClientRequest.get(FRAMES_URL, { urlParams: { limit: String(FRAME_LIMIT) } }).pipe(
            HttpClientRequest.setHeaders({
              authorization: `Bearer ${token}`,
              "anthropic-beta": "oauth-2025-04-20",
              accept: "application/json",
              // Routes the request to the artifact service; without it the API answers 404.
              "x-frame-cp": "go",
              "user-agent": "t3code",
            }),
          ),
        )
        .pipe(
          Effect.timeout("15 seconds"),
          Effect.mapError(() => requestFailed()),
        );
      const failure = claudeArtifactsFailureForStatus(response.status);
      if (failure !== undefined) {
        return yield* new ClaudeArtifactsError({
          instanceId,
          reason: failure,
          status: response.status,
        });
      }
      const body = yield* HttpClientResponse.schemaBodyJson(FramesResponse)(response).pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(() => requestFailed(response.status)),
      );
      const frames = body.frames ?? [];
      return {
        artifacts: parseClaudeArtifactFrames(frames),
        truncated: frames.length >= FRAME_LIMIT,
      } satisfies Listing;
    },
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );

  const listings = yield* Cache.makeWith<ProviderInstanceId, Listing, ClaudeArtifactsError>(
    fetchListing,
    {
      capacity: 32,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(60) : Duration.zero),
    },
  );

  const list: ClaudeArtifacts["Service"]["list"] = Effect.fn("ClaudeArtifacts.list")(
    function* (input) {
      const listing = yield* Cache.get(listings, input.instanceId);
      const scope = input.scope ?? "all";
      const matching =
        scope === "all"
          ? listing.artifacts
          : listing.artifacts.filter((artifact) => artifact.relation === scope);
      const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
      const end = offset + (input.limit ?? DEFAULT_PAGE_SIZE);
      return {
        artifacts: matching.slice(offset, end),
        ...(end < matching.length ? { nextCursor: String(end) } : {}),
        truncated: listing.truncated,
      };
    },
  );

  const describeInstance = Effect.fn("ClaudeArtifacts.describeInstance")(
    function* (
      providerInstances: Record<string, ProviderInstanceConfig>,
      instanceId: ProviderInstanceId,
    ) {
      const home = yield* resolveInstanceHome(providerInstances, instanceId);
      const identity = yield* fileSystem.readFileString(home.accountConfigPath).pipe(
        Effect.map(claudeAccountIdentity),
        Effect.orElseSucceed((): ClaudeAccountIdentity => ({})),
      );
      // Only checks that a token is present; it is not kept or returned.
      const listable = yield* readAccessToken(instanceId, home.configDir).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      return { instanceId, ...identity, listable } satisfies ClaudeArtifactsAccount;
    },
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );

  const accounts: ClaudeArtifacts["Service"]["accounts"] = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings.pipe(Effect.option);
    if (Option.isNone(settings)) return { accounts: [] };
    const providerInstances = settings.value.providerInstances;
    const defaultId = defaultInstanceIdForDriver(CLAUDE_DRIVER);
    const instanceIds = [
      ...new Set([...(Object.keys(providerInstances) as ProviderInstanceId[]), defaultId]),
    ];
    const described = yield* Effect.forEach(
      instanceIds,
      (instanceId) => describeInstance(providerInstances, instanceId).pipe(Effect.option),
      { concurrency: 4 },
    );
    return { accounts: described.flatMap((entry) => Option.toArray(entry)) };
  }).pipe(Effect.withSpan("ClaudeArtifacts.accounts"));

  return ClaudeArtifacts.of({ list, accounts });
});

export const layer = Layer.effect(ClaudeArtifacts, make);
