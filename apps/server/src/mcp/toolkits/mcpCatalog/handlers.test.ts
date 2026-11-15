import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, type RuntimeMode, ThreadId } from "@t3tools/contracts";
import { McpSchema } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as McpCatalog from "../../../mcpCatalog/McpCatalog.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as McpCatalogHandlers from "./handlers.ts";
import { McpCallToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:mcp-catalog");

const layerFor = (runtimeMode: RuntimeMode, calls: Array<string>) =>
  McpToolAccess.HandlersLayer.layer(McpCatalogHandlers.layerCall).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:mcp-catalog"),
          requestNamespace: "provider:mcp-catalog",
          thread: {
            threadId,
            providerSessionId: "provider:mcp-catalog",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(liveThreadShell(threadId, { runtimeMode })),
        }),
        Layer.mock(McpCatalog.McpCatalog)({
          resolveTool: (server, tool) =>
            Effect.succeed({
              server,
              tool: new McpSchema.Tool({ name: tool, inputSchema: { type: "object" } }),
              readOnly: tool === "search",
            }),
          callTool: (resolved) =>
            Effect.sync(() => {
              calls.push(resolved.tool.name);
              return new McpSchema.CallToolResult({
                content: [{ type: "text", text: `ran ${resolved.tool.name}` }],
              });
            }),
        }),
      ),
    ),
  );

const callTool = (tool: string) =>
  Effect.gen(function* () {
    const toolkit = yield* McpCallToolkit;
    return yield* toolkit.handle("mcp_call", { server: "notes", tool }).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((parts) => parts.at(-1)?.result),
    );
  });

it.effect("lets a supervised thread run only read-only catalog tools", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    yield* Effect.gen(function* () {
      expect(yield* callTool("search")).toMatchObject({ isError: false });
      expect(yield* callTool("delete_page").pipe(Effect.flip)).toMatchObject({
        code: "capability_denied",
      });
    }).pipe(Effect.provide(layerFor("approval-required", calls)));
    expect(calls).toEqual(["search"]);

    yield* callTool("delete_page").pipe(Effect.provide(layerFor("full-access", calls)));
    expect(calls).toEqual(["search", "delete_page"]);
  }),
);
