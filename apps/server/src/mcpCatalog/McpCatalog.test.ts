import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { McpCatalogServer } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpCatalog from "./McpCatalog.ts";
import { parseCodexMcpServers, parseJsonMcpServers, toCandidate } from "./McpCatalogImport.ts";

// A stdio MCP server: two tools, one read-only, and an echo that shows its environment.
const FIXTURE_SERVER = String.raw`
const tools = [
  { name: "echo", description: "Echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "draw", description: "Draw a picture", inputSchema: { type: "object" } },
];
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === "") continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
    if (message.method === "initialize") {
      reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.2.3" } });
    } else if (message.method === "tools/list") {
      reply({ tools });
    } else if (message.method === "tools/call" && message.params.name === "echo") {
      reply({ content: [{ type: "text", text: message.params.arguments.text + " token=" + (process.env.FIXTURE_TOKEN ?? "none") }] });
    } else if (message.method === "tools/call") {
      reply({ content: [{ type: "text", text: "drawn" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }] });
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } }) + "\n");
    }
  }
});
`;

const layer = (baseDir: string) =>
  McpCatalog.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(ServerSettings.layerTest()),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const fixtureServer = Effect.fn(function* (
  directory: string,
  overrides: Partial<McpCatalogServer>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const script = path.join(directory, "fixture-mcp.cjs");
  yield* fileSystem.writeFileString(script, FIXTURE_SERVER);
  return {
    id: "fixture",
    name: "Fixture",
    enabled: true,
    transport: { type: "stdio", command: process.execPath, args: [script] },
    env: [],
    headers: [],
    ...overrides,
  } satisfies McpCatalogServer;
});

it.live("keeps a secret out of the catalog file and keeps it when an edit leaves it blank", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mcp-catalog-" });
    yield* Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      const config = yield* ServerConfig.ServerConfig;
      const server = yield* fixtureServer(directory, {
        env: [{ name: "FIXTURE_TOKEN", value: "s3cret-value", secret: true }],
      });
      const saved = yield* catalog.upsert({ server });
      const published = yield* Stream.runHead(catalog.changes);
      assert.deepEqual(
        Option.map(published, (snapshot) => snapshot.servers.map((entry) => entry.id)),
        Option.some(["fixture"]),
      );
      assert.deepEqual(saved.servers[0]?.env, [
        { name: "FIXTURE_TOKEN", value: "", secret: true, stored: true },
      ]);
      const file = yield* fileSystem.readFileString(`${config.stateDir}/mcp-catalog.json`);
      assert.notInclude(file, "s3cret-value");

      // The settings page sends the stored secret back blank.
      yield* catalog.upsert({
        previousId: "fixture",
        server: {
          ...server,
          env: [{ name: "FIXTURE_TOKEN", value: "", secret: true, stored: true }],
        },
      });
      const echo = yield* catalog.resolveTool("fixture", "echo");
      const result = yield* catalog.callTool(echo, { text: "hi" });
      assert.deepEqual(
        result.content.map((block) => (block.type === "text" ? block.text : block.type)),
        ["hi token=s3cret-value"],
      );
    }).pipe(Effect.provide(layer(directory)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.live("finds catalog tools and passes their results through, images included", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mcp-catalog-" });
    yield* Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      yield* catalog.upsert({ server: yield* fixtureServer(directory, {}) });

      const found = yield* catalog.search({ query: "picture" });
      assert.deepEqual(
        found.tools.map((tool) => [tool.server, tool.name, tool.readOnly]),
        [["fixture", "draw", false]],
      );
      const listed = yield* catalog.listServers;
      assert.deepEqual(listed, [
        {
          id: "fixture",
          name: "Fixture",
          state: "connected",
          error: null,
          tools: ["echo", "draw"],
        },
      ]);
      const draw = yield* catalog.resolveTool("fixture", "draw");
      assert.isFalse(draw.readOnly);
      const result = yield* catalog.callTool(draw, {});
      assert.deepEqual(
        result.content.map((block) => block.type),
        ["text", "image"],
      );
      const snapshot = yield* catalog.snapshot;
      assert.equal(snapshot.statuses[0]?.serverVersion, "1.2.3");
    }).pipe(Effect.provide(layer(directory)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.live("reports a server that cannot start while the others still answer", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mcp-catalog-" });
    yield* Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      yield* catalog.upsert({ server: yield* fixtureServer(directory, {}) });
      yield* catalog.upsert({
        server: yield* fixtureServer(directory, {
          id: "broken",
          name: "Broken",
          transport: { type: "stdio", command: `${directory}/missing-binary`, args: [] },
        }),
      });
      const found = yield* catalog.search({ query: "echo" });
      assert.deepEqual(
        found.tools.map((tool) => tool.name),
        ["echo"],
      );
      assert.deepEqual(
        found.unavailable.map((entry) => entry.server),
        ["broken"],
      );
      // Turning a server off is an edit; it keeps its place in the list.
      const fixture = yield* fixtureServer(directory, {});
      const edited = yield* catalog.upsert({
        previousId: "fixture",
        server: { ...fixture, enabled: false },
      });
      assert.deepEqual(
        edited.servers.map((server) => [server.id, server.enabled]),
        [
          ["fixture", false],
          ["broken", true],
        ],
      );
      const snapshot = yield* catalog.snapshot;
      const broken = snapshot.statuses.find((status) => status.id === "broken");
      assert.equal(broken?.state, "error");
      assert.equal(
        broken?.error,
        `Could not start \`${directory}/missing-binary\`. Check that it is installed on this machine.`,
      );
    }).pipe(Effect.provide(layer(directory)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it("reads MCP servers from Claude, Cursor, and Codex config files", () => {
  const json = parseJsonMcpServers(
    JSON.stringify({
      mcpServers: {
        "Linear Tasks": {
          type: "http",
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: "Bearer x" },
        },
        files: { command: "npx", args: ["-y", "files-mcp"], env: { API_KEY: "k", MODE: "fast" } },
      },
    }),
  );
  const toml = parseCodexMcpServers(
    [
      "model = 'gpt'",
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "-i", "ghcr.io/github/github-mcp-server"] # pinned',
      'env = { GITHUB_TOKEN = "ghp_1" }',
      "[mcp_servers.notion]",
      'url = "https://mcp.notion.com/mcp"',
      'bearer_token_env_var = "NOTION_TOKEN"',
      "enabled = false",
    ].join("\n"),
    { NOTION_TOKEN: "ntn_1" },
  );
  const candidates = [...json, ...toml].map((raw) => toCandidate("claude", raw));
  assert.deepEqual(
    candidates.map((candidate) => candidate?.server),
    [
      {
        id: "linear-tasks",
        name: "Linear Tasks",
        enabled: true,
        transport: { type: "http", url: "https://mcp.linear.app/mcp" },
        env: [],
        headers: [{ name: "Authorization", value: "", secret: true }],
      },
      {
        id: "files",
        name: "files",
        enabled: true,
        transport: { type: "stdio", command: "npx", args: ["-y", "files-mcp"] },
        env: [
          { name: "API_KEY", value: "", secret: true },
          { name: "MODE", value: "fast", secret: false },
        ],
        headers: [],
      },
      {
        id: "github",
        name: "github",
        enabled: true,
        transport: {
          type: "stdio",
          command: "docker",
          args: ["run", "-i", "ghcr.io/github/github-mcp-server"],
        },
        env: [{ name: "GITHUB_TOKEN", value: "", secret: true }],
        headers: [],
      },
      {
        id: "notion",
        name: "notion",
        enabled: false,
        transport: { type: "http", url: "https://mcp.notion.com/mcp" },
        env: [],
        headers: [{ name: "Authorization", value: "", secret: true }],
      },
    ],
  );
  assert.deepEqual(candidates[3]?.secrets.headers, { Authorization: "Bearer ntn_1" });
  assert.deepEqual(candidates[1]?.secrets.env, { API_KEY: "k" });
});
