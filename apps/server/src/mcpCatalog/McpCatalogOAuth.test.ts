// @effect-diagnostics nodeBuiltinImport:off - the fixture is a plain Node HTTP server.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpCatalog from "./McpCatalog.ts";
import { challengeParameter, wellKnownUrls } from "./McpCatalogOAuth.ts";

interface Fixture {
  url: string;
  readonly grants: Array<string>;
  // Codes the browser step issued, with their PKCE challenge.
  readonly challenges: Map<string, string>;
  // Seconds the next issued access token lives.
  expiresIn: number;
}

/** An MCP server behind OAuth: 401 until a bearer token it issued arrives. */
const startFixture = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{ readonly fixture: Fixture; readonly server: NodeHttp.Server }>((resolve) => {
        const issued = new Set<string>();
        let tokenNumber = 0;
        const fixture: Fixture = { url: "", grants: [], challenges: new Map(), expiresIn: 3600 };
        const challenges = fixture.challenges;
        const server = NodeHttp.createServer((request, response) => {
          const origin = `http://${request.headers.host}`;
          const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
            response.writeHead(status, { "content-type": "application/json", ...headers });
            response.end(JSON.stringify(body));
          };
          let raw = "";
          request.on("data", (chunk) => (raw += chunk));
          request.on("end", () => {
            const url = new URL(request.url ?? "/", origin);
            if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
              return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
            }
            if (url.pathname === "/.well-known/oauth-authorization-server") {
              return json(200, {
                authorization_endpoint: `${origin}/authorize`,
                token_endpoint: `${origin}/token`,
                registration_endpoint: `${origin}/register`,
                code_challenge_methods_supported: ["S256"],
              });
            }
            if (url.pathname === "/register") return json(201, { client_id: "client-1" });
            if (url.pathname === "/token") {
              const form = new URLSearchParams(raw);
              fixture.grants.push(form.get("grant_type") ?? "");
              const verifier = form.get("code_verifier") ?? "";
              const valid =
                form.get("grant_type") === "refresh_token"
                  ? form.get("refresh_token") === "refresh-1"
                  : form.get("resource") === `${origin}/mcp` &&
                    challenges.get(form.get("code") ?? "") ===
                      NodeCrypto.createHash("sha256").update(verifier).digest("base64url");
              if (!valid) return json(400, { error: "invalid_grant" });
              tokenNumber += 1;
              const accessToken = `token-${tokenNumber}`;
              issued.add(accessToken);
              return json(200, {
                access_token: accessToken,
                refresh_token: "refresh-1",
                expires_in: fixture.expiresIn,
              });
            }
            if (url.pathname === "/mcp") {
              const token = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
              if (!issued.has(token)) {
                return json(
                  401,
                  { error: "unauthorized" },
                  {
                    "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
                  },
                );
              }
              const message = JSON.parse(raw);
              if (message.id === undefined) {
                response.writeHead(202);
                return response.end();
              }
              const result =
                message.method === "initialize"
                  ? {
                      protocolVersion: message.params.protocolVersion,
                      capabilities: { tools: {} },
                      serverInfo: { name: "notes", version: "2.0.0" },
                    }
                  : message.method === "tools/list"
                    ? { tools: [{ name: "search_notes", inputSchema: { type: "object" } }] }
                    : {};
              return json(200, { jsonrpc: "2.0", id: message.id, result });
            }
            return json(404, {});
          });
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          fixture.url = `http://127.0.0.1:${port}/mcp`;
          resolve({ fixture, server });
        });
      }),
  ),
  ({ server }) => Effect.promise(() => new Promise<void>((done) => server.close(() => done()))),
);

const layer = (baseDir: string) =>
  McpCatalog.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(ServerSettings.layerTest()),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)),
  );

it("reads the parts of an OAuth challenge and the well-known metadata paths", () => {
  const header = 'Bearer realm="mcp", resource_metadata="https://x.test/.well-known/r", scope=read';
  assert.equal(challengeParameter(header, "resource_metadata"), "https://x.test/.well-known/r");
  assert.equal(challengeParameter(header, "scope"), "read");
  assert.isUndefined(challengeParameter(undefined, "scope"));
  assert.deepEqual(wellKnownUrls("https://x.test/v1/mcp", "oauth-protected-resource"), [
    "https://x.test/.well-known/oauth-protected-resource/v1/mcp",
    "https://x.test/.well-known/oauth-protected-resource",
  ]);
});

it.live("signs in to a server behind OAuth, refreshes its token, and signs out", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mcp-oauth-" });
    const { fixture } = yield* startFixture;
    yield* Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      yield* catalog.upsert({
        server: {
          id: "notes",
          name: "Notes",
          enabled: true,
          transport: { type: "http", url: fixture.url },
          env: [],
          headers: [],
        },
      });
      const refused = yield* catalog.search({ query: "notes" });
      assert.deepEqual(refused.unavailable, [
        { server: "notes", error: "Sign in to use this server." },
      ]);
      assert.equal((yield* catalog.snapshot).statuses[0]?.auth, "required");

      const redirectUri = "http://127.0.0.1:13773/api/mcp-catalog/oauth/callback";
      const { authorizationUrl } = yield* catalog.startSignIn({ id: "notes", redirectUri });
      const authorization = new URL(authorizationUrl);
      assert.equal(authorization.searchParams.get("client_id"), "client-1");
      assert.equal(authorization.searchParams.get("redirect_uri"), redirectUri);
      assert.equal(authorization.searchParams.get("resource"), fixture.url);
      assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      // The test plays the browser: the user signs in and the server issues a code.
      fixture.challenges.set("the-code", authorization.searchParams.get("code_challenge") ?? "");

      // The first token is already expired, so the next connection refreshes it.
      fixture.expiresIn = 0;
      const signedIn = yield* catalog.completeSignIn({
        state: authorization.searchParams.get("state") ?? "",
        code: "the-code",
        error: undefined,
      });
      assert.equal(signedIn.serverName, "Notes");
      const listed = yield* catalog.listServers;
      assert.deepEqual(listed[0]?.tools, ["search_notes"]);
      assert.equal((yield* catalog.snapshot).statuses[0]?.auth, "signed-in");
      assert.deepEqual(fixture.grants, ["authorization_code", "refresh_token"]);

      // A state is single use.
      const replayed = yield* catalog
        .completeSignIn({
          state: authorization.searchParams.get("state") ?? "",
          code: "the-code",
          error: undefined,
        })
        .pipe(Effect.flip);
      assert.equal(replayed.message, "This sign-in expired. Start it again from Settings.");

      yield* catalog.signOut("notes");
      const afterSignOut = yield* catalog.search({ query: "notes" });
      assert.deepEqual(
        afterSignOut.unavailable.map((entry) => entry.error),
        ["Sign in to use this server."],
      );
    }).pipe(Effect.provide(layer(directory)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
