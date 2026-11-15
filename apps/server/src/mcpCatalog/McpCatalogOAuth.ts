// @effect-diagnostics nodeBuiltinImport:off - PKCE needs synchronous SHA-256 and random bytes.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Schema from "effect/Schema";

// MCP authorization: protected resource metadata (RFC 9728), authorization server metadata
// (RFC 8414 / OIDC discovery), dynamic client registration (RFC 7591), and the authorization
// code flow with PKCE and resource indicators (RFC 8707).

/** What a signed-in server keeps in the secret store. */
export const StoredOAuth = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optionalKey(Schema.String),
  tokenEndpoint: Schema.String,
  resource: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.optionalKey(Schema.String),
  // Epoch milliseconds.
  expiresAt: Schema.optionalKey(Schema.Number),
});
export type StoredOAuth = typeof StoredOAuth.Type;

export interface OAuthPlan {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | undefined;
  readonly resource: string;
  readonly scope: string | undefined;
}

export class McpCatalogOAuthError extends Schema.TaggedError<McpCatalogOAuthError>()(
  "McpCatalogOAuthError",
  { message: Schema.String },
) {}

const oauthError = (message: string) => new McpCatalogOAuthError({ message });

const ProtectedResourceMetadata = Schema.Struct({
  resource: Schema.optionalKey(Schema.String),
  authorization_servers: Schema.optionalKey(Schema.Array(Schema.String)),
  scopes_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});
const AuthorizationServerMetadata = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optionalKey(Schema.String),
  code_challenge_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});
const ClientRegistration = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optionalKey(Schema.String),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
});
type TokenResponse = typeof TokenResponse.Type;

/** A parameter of a `WWW-Authenticate: Bearer ...` challenge, such as `resource_metadata`. */
export const challengeParameter = (header: string | undefined, name: string) => {
  if (header === undefined) return undefined;
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,]+))`, "iu").exec(header);
  return match?.[1] ?? match?.[2];
};

/** The MCP endpoint without a fragment, as RFC 8707 wants the resource. */
export const canonicalResource = (url: string) => {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
};

/** Where RFC 9728 and RFC 8414 put metadata for a URL with a path. */
export const wellKnownUrls = (url: string, suffix: string) => {
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/u, "");
  const urls = [`${parsed.origin}/.well-known/${suffix}${path}`];
  if (path !== "") urls.push(`${parsed.origin}/.well-known/${suffix}`);
  return urls;
};

const pkcePair = () => {
  const verifier = NodeCrypto.randomBytes(32).toString("base64url");
  const challenge = NodeCrypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

export const randomState = () => NodeCrypto.randomBytes(24).toString("base64url");

const fetchJson = Effect.fnUntraced(function* <S extends Schema.Top>(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
) {
  return yield* client.execute(HttpClientRequest.acceptJson(request)).pipe(
    Effect.flatMap((response) =>
      response.status < 200 || response.status >= 300
        ? Effect.undefined
        : response.json.pipe(Effect.flatMap((body) => Schema.decodeEffect(schema)(body))),
    ),
    // Any failure, from the network to an unexpected body, reads as no answer.
    Effect.orElseSucceed(() => undefined),
  );
});

/** Finds how to sign in to an MCP server from its 401 challenge and well-known metadata. */
export const discover = Effect.fn("McpCatalogOAuth.discover")(function* (input: {
  readonly url: string;
  readonly wwwAuthenticate: string | undefined;
}) {
  const client = yield* HttpClient.HttpClient;
  const resource = canonicalResource(input.url);
  const pointed = challengeParameter(input.wwwAuthenticate, "resource_metadata");
  const metadataUrls =
    pointed === undefined ? wellKnownUrls(resource, "oauth-protected-resource") : [pointed];
  let protectedResource: typeof ProtectedResourceMetadata.Type | undefined;
  for (const url of metadataUrls) {
    protectedResource = yield* fetchJson(
      client,
      HttpClientRequest.get(url),
      ProtectedResourceMetadata,
    ).pipe(Effect.orElseSucceed(() => undefined));
    if (protectedResource !== undefined) break;
  }
  // Servers from before RFC 9728 support act as their own authorization server.
  const issuer = protectedResource?.authorization_servers?.[0] ?? new URL(resource).origin;
  const issuerPath = new URL(issuer).pathname.replace(/\/$/u, "");
  const issuerOrigin = new URL(issuer).origin;
  const candidates = [
    `${issuerOrigin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${issuerOrigin}/.well-known/openid-configuration${issuerPath}`,
    ...(issuerPath === "" ? [] : [`${issuerOrigin}${issuerPath}/.well-known/openid-configuration`]),
  ];
  let server: typeof AuthorizationServerMetadata.Type | undefined;
  for (const url of candidates) {
    server = yield* fetchJson(client, HttpClientRequest.get(url), AuthorizationServerMetadata).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (server !== undefined) break;
  }
  if (server === undefined) {
    return yield* oauthError(
      "This server asks for a sign-in but does not say how. Use a token header instead.",
    );
  }
  if (
    server.code_challenge_methods_supported !== undefined &&
    !server.code_challenge_methods_supported.includes("S256")
  ) {
    return yield* oauthError("This server's sign-in does not support PKCE, which T3 Code needs.");
  }
  const scope =
    challengeParameter(input.wwwAuthenticate, "scope") ??
    (protectedResource?.scopes_supported?.length
      ? protectedResource.scopes_supported.join(" ")
      : undefined);
  return {
    authorizationEndpoint: server.authorization_endpoint,
    tokenEndpoint: server.token_endpoint,
    registrationEndpoint: server.registration_endpoint,
    resource: protectedResource?.resource ?? resource,
    scope,
  } satisfies OAuthPlan;
});

/** Registers T3 Code as a public client for one redirect URI. */
export const register = Effect.fn("McpCatalogOAuth.register")(function* (
  plan: OAuthPlan,
  redirectUri: string,
) {
  if (plan.registrationEndpoint === undefined) {
    return yield* oauthError(
      "This server does not let new apps register for sign-in. Use a token header instead.",
    );
  }
  const client = yield* HttpClient.HttpClient;
  const registered = yield* fetchJson(
    client,
    HttpClientRequest.post(plan.registrationEndpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        client_name: "T3 Code",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    ),
    ClientRegistration,
  );
  if (registered === undefined) {
    return yield* oauthError(
      `The server would not register T3 Code for sign-in with ${redirectUri}. It may only allow https addresses.`,
    );
  }
  return { clientId: registered.client_id, clientSecret: registered.client_secret };
});

export const authorizationRequest = (input: {
  readonly plan: OAuthPlan;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}) => {
  const { verifier, challenge } = pkcePair();
  const url = new URL(input.plan.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("resource", input.plan.resource);
  if (input.plan.scope !== undefined) url.searchParams.set("scope", input.plan.scope);
  return { url: url.href, verifier };
};

const requestToken = Effect.fnUntraced(function* (
  tokenEndpoint: string,
  params: Record<string, string | undefined>,
) {
  const client = yield* HttpClient.HttpClient;
  const body = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );
  const token = yield* fetchJson(
    client,
    HttpClientRequest.post(tokenEndpoint).pipe(HttpClientRequest.bodyUrlParams(body)),
    TokenResponse,
  );
  if (token === undefined) return yield* oauthError("The server did not accept the sign-in.");
  return token;
});

const stored = (
  base: Omit<StoredOAuth, "accessToken" | "refreshToken" | "expiresAt">,
  token: TokenResponse,
  previousRefreshToken: string | undefined,
  now: number,
): StoredOAuth => {
  const refreshToken = token.refresh_token ?? previousRefreshToken;
  return {
    ...base,
    accessToken: token.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(token.expires_in === undefined ? {} : { expiresAt: now + token.expires_in * 1_000 }),
  };
};

export const exchangeCode = Effect.fn("McpCatalogOAuth.exchangeCode")(function* (input: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resource: string;
  readonly redirectUri: string;
  readonly verifier: string;
  readonly code: string;
  readonly now: number;
}) {
  const token = yield* requestToken(input.tokenEndpoint, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.verifier,
    resource: input.resource,
  });
  return stored(
    {
      clientId: input.clientId,
      ...(input.clientSecret === undefined ? {} : { clientSecret: input.clientSecret }),
      tokenEndpoint: input.tokenEndpoint,
      resource: input.resource,
    },
    token,
    undefined,
    input.now,
  );
});

export const refresh = Effect.fn("McpCatalogOAuth.refresh")(function* (
  current: StoredOAuth,
  now: number,
) {
  if (current.refreshToken === undefined) return yield* oauthError("Sign in again.");
  const token = yield* requestToken(current.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: current.clientId,
    client_secret: current.clientSecret,
    resource: current.resource,
  });
  const { accessToken: _a, refreshToken: _r, expiresAt: _e, ...base } = current;
  return stored(base, token, current.refreshToken, now);
});

/** True when the token is gone or within a minute of expiring. */
export const needsRefresh = (auth: StoredOAuth, now: number) =>
  auth.expiresAt !== undefined && auth.expiresAt - now < 60_000;
