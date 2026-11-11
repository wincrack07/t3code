import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  type CliReleaseChannel,
} from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
export class ReleaseDiscoveryError extends Schema.TaggedError<ReleaseDiscoveryError>()(
  "ReleaseDiscoveryError",
  { reason: Schema.String },
) {}
const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optional(Schema.Boolean),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));

const RELEASE_INDEX_TIMEOUT = Duration.seconds(30);
const RELEASE_INDEX_MAX_PAGES = 10;

export const resolveNewestVersion = Effect.fn("cli.update.resolve_newest")(function* (
  channel: CliReleaseChannel,
  releaseBaseUrl?: string,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  const githubToken = environment.GH_TOKEN?.trim() || environment.GITHUB_TOKEN?.trim() || undefined;
  let newest: string | undefined;
  for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
    const url = yield* Effect.try({
      try: () => cliReleaseIndexPageUrl(page, releaseBaseUrl),
      catch: () =>
        new ReleaseDiscoveryError({
          reason: "Release discovery requires a GitHub releases/download URL.",
        }),
    });
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
    );
    const authenticatedRequest =
      githubToken === undefined
        ? request
        : HttpClientRequest.setHeader(request, "Authorization", `Bearer ${githubToken}`);
    const body = yield* httpClient.execute(authenticatedRequest).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.mapError(() => new ReleaseDiscoveryError({ reason: "Could not list t3 releases." })),
      Effect.timeoutOrElse({
        duration: RELEASE_INDEX_TIMEOUT,
        orElse: () =>
          Effect.fail(new ReleaseDiscoveryError({ reason: "Timed out listing t3 releases." })),
      }),
    );
    const releases = yield* decodeReleaseIndex(body).pipe(
      Effect.mapError(
        () =>
          new ReleaseDiscoveryError({ reason: "The t3 release index had an unexpected shape." }),
      ),
    );
    const version = newestCliReleaseVersion(releases, channel);
    if (
      version !== undefined &&
      (newest === undefined || compareSemverVersions(version, newest) > 0)
    )
      newest = version;
    if (releases.length === 0 || (newest !== undefined && releases.length < 100)) break;
  }
  if (newest !== undefined) return newest;
  return yield* new ReleaseDiscoveryError({ reason: `No published ${channel} release was found.` });
});
