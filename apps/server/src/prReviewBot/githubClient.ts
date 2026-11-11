// @effect-diagnostics nodeBuiltinImport:off - RS256 signing for the GitHub App JWT.
import * as NodeCrypto from "node:crypto";

import { PrReviewError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import { rateLimitRetryAtMs } from "./pollingBackoff.ts";

const API = "https://api.github.com";

export interface GitHubRequest {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Relative to the API root, with its query string. */
  readonly path: string;
  readonly body?: unknown;
  /** Answered 304, which GitHub does not count against the quota. */
  readonly etag?: string | undefined;
}

export interface GitHubResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

/** One HTTP exchange; the only part tests replace. */
export type GitHubSend = (
  token: string,
  request: GitHubRequest,
) => Effect.Effect<GitHubResponse, PrReviewError>;

export class GitHubCallError extends Schema.TaggedError<GitHubCallError>()("GitHubCallError", {
  operation: Schema.String,
  status: Schema.Number,
  detail: Schema.String,
  retryAtMs: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    return `GitHub ${this.operation} failed (${this.status}): ${this.detail}`;
  }
}

export const makeFetchSend = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const send: GitHubSend = (token, request) => {
    const base = HttpClientRequest.make(request.method ?? "GET")(`${API}${request.path}`).pipe(
      HttpClientRequest.setHeaders({
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "t3code-pr-review",
        ...(request.etag ? { "If-None-Match": request.etag } : {}),
      }),
    );
    const withBody =
      request.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, request.body);
    return http.execute(withBody).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.map((body) => ({
            status: response.status,
            headers: response.headers as Readonly<Record<string, string | undefined>>,
            body,
          })),
        ),
      ),
      Effect.timeout("30 seconds"),
      Effect.mapError(
        (cause) =>
          new PrReviewError({ detail: `Could not reach GitHub: ${String(cause).slice(0, 200)}` }),
      ),
    );
  };
  return send;
});

/** The account the bot acts as, and a token for it. */
export interface ReviewIdentity {
  readonly mode: "github-app" | "gh";
  readonly token: Effect.Effect<string, PrReviewError>;
  readonly login: Effect.Effect<string, PrReviewError>;
}

const AccessToken = Schema.fromJsonString(
  Schema.Struct({ token: Schema.String, expires_at: Schema.String }),
);
const AppInfo = Schema.fromJsonString(Schema.Struct({ slug: Schema.String }));
const UserInfo = Schema.fromJsonString(Schema.Struct({ login: Schema.String }));

const decodeAccessToken = Schema.decodeEffect(AccessToken);
const decodeAppInfo = Schema.decodeEffect(AppInfo);
const decodeUserInfo = Schema.decodeEffect(UserInfo);

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** A ten-minute app JWT (GitHub's maximum), backdated a minute for clock skew. */
function signAppJwt(appId: string, privateKeyPem: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signature = NodeCrypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), {
    key: privateKeyPem,
  });
  return `${header}.${payload}.${base64Url(signature)}`;
}

export const isValidPrivateKey = (pem: string) => {
  try {
    return NodeCrypto.createPrivateKey(pem).asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
};

const identityError = (detail: string) => new PrReviewError({ detail });

/** Installation tokens last an hour; one is reused until five minutes before it expires. */
export const makeAppIdentity = Effect.fn("PrReviewIdentity.app")(function* (input: {
  readonly appId: string;
  readonly installationId: string;
  readonly appSlug: string;
  readonly privateKey: string;
  readonly send: GitHubSend;
  readonly nowMs: Effect.Effect<number>;
}) {
  const cached = yield* Ref.make<{ readonly token: string; readonly expiresAtMs: number } | null>(
    null,
  );
  const jwt = Effect.gen(function* () {
    const now = yield* input.nowMs;
    return yield* Effect.try({
      try: () => signAppJwt(input.appId, input.privateKey, now),
      catch: () => identityError("The GitHub App private key could not sign a token."),
    });
  });
  const token = Effect.gen(function* () {
    const now = yield* input.nowMs;
    const current = yield* Ref.get(cached);
    if (current !== null && current.expiresAtMs - now > 5 * 60_000) return current.token;
    const response = yield* input.send(yield* jwt, {
      method: "POST",
      path: `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
    });
    if (response.status !== 201) {
      return yield* identityError(
        `GitHub refused an installation token (${response.status}). Check the App ID, installation ID and private key.`,
      );
    }
    const decoded = yield* decodeAccessToken(response.body).pipe(
      Effect.mapError(() => identityError("GitHub answered the token request unexpectedly.")),
    );
    yield* Ref.set(cached, { token: decoded.token, expiresAtMs: Date.parse(decoded.expires_at) });
    return decoded.token;
  });
  const login =
    input.appSlug !== ""
      ? Effect.succeed(`${input.appSlug}[bot]`)
      : Effect.gen(function* () {
          const response = yield* input.send(yield* jwt, { path: "/app" });
          const app = yield* decodeAppInfo(response.body).pipe(
            Effect.mapError(() => identityError("Could not read the GitHub App's name.")),
          );
          return `${app.slug}[bot]`;
        });
  return { mode: "github-app", token, login: yield* Effect.cached(login) } satisfies ReviewIdentity;
});

export const makeGhIdentity = Effect.fn("PrReviewIdentity.gh")(function* (input: {
  readonly readToken: Effect.Effect<string, PrReviewError>;
  readonly send: GitHubSend;
}) {
  const token = yield* Effect.cachedWithTTL(input.readToken, "10 minutes");
  const login = Effect.gen(function* () {
    const response = yield* input.send(yield* token, { path: "/user" });
    if (response.status !== 200) {
      return yield* identityError(`The gh login was refused (${response.status}).`);
    }
    const user = yield* decodeUserInfo(response.body).pipe(
      Effect.mapError(() => identityError("Could not read the gh login.")),
    );
    return user.login;
  });
  return { mode: "gh", token, login: yield* Effect.cached(login) } satisfies ReviewIdentity;
});

/** The login, once GitHub has accepted a token for it; a slug alone proves nothing. */
export const verifiedLogin = (identity: ReviewIdentity) =>
  identity.token.pipe(Effect.andThen(identity.login));

/** Sends as `identity`, failing on any status but the expected ones. */
export const call = Effect.fn("PrReviewGitHub.call")(function* (
  identity: ReviewIdentity,
  send: GitHubSend,
  operation: string,
  request: GitHubRequest,
  okStatuses: ReadonlyArray<number> = [200, 201, 204],
) {
  const response = yield* send(yield* identity.token, request);
  if (okStatuses.includes(response.status) || response.status === 304) return response;
  const retryAtMs = rateLimitRetryAtMs({
    status: response.status,
    headers: response.headers,
    nowMs: yield* Clock.currentTimeMillis,
  });
  return yield* new GitHubCallError({
    operation,
    status: response.status,
    detail: response.body.slice(0, 300),
    ...(retryAtMs === undefined ? {} : { retryAtMs }),
  });
});
