import { type McpCatalogError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpCatalog from "../../../mcpCatalog/McpCatalog.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, loadCaller } from "../../threadAccess.ts";
import { McpCallToolkit, McpToolsToolkit } from "./tools.ts";

const toFailure = (error: McpCatalogError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

export const layerTools = McpToolAccess.toLayer(McpToolsToolkit, {
  mcp_tools: McpToolAccess.reads(({ query, server }) =>
    Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      const text = query?.trim() ?? "";
      if (text === "" && server === undefined) {
        return { servers: yield* catalog.listServers };
      }
      return yield* catalog.search({ query: text, server }).pipe(Effect.mapError(toFailure));
    }),
  ),
});

export const layerCall = McpToolAccess.toLayer(McpCallToolkit, {
  mcp_call: McpToolAccess.writesWithCapability(({ server, tool, arguments: args }) =>
    Effect.gen(function* () {
      const catalog = yield* McpCatalog.McpCatalog;
      const resolved = yield* catalog.resolveTool(server, tool).pipe(Effect.mapError(toFailure));
      if (!resolved.readOnly) {
        yield* assertFullAccess(
          yield* loadCaller(),
          `\`${tool}\` can change things outside T3 Code, so it needs a full-access caller. Read-only catalog tools work from any thread.`,
        );
      }
      const result = yield* catalog.callTool(resolved, args ?? {}).pipe(Effect.mapError(toFailure));
      return {
        content: result.content,
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
        isError: result.isError === true,
      };
    }),
  ),
});
