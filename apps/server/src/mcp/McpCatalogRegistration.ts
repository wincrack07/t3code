import { McpSchema, McpServer, Tool, type Toolkit } from "effect/ai";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as McpCatalog from "../mcpCatalog/McpCatalog.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { McpCallTool, McpCallToolkit } from "./toolkits/mcpCatalog/tools.ts";

type McpCallResult = {
  // Content blocks from the catalog server's own CallToolResult, passed through unchanged.
  readonly content: McpSchema.CallToolResult["content"];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
};

const callFailure = <E>(cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const error = cause.reasons.find(Cause.isFailReason)?.error;
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message !== ""
      ? error.message
      : "mcp_call failed.";
  return Effect.succeed(
    new McpSchema.CallToolResult({
      isError: true,
      structuredContent: { error: { message } },
      content: [{ type: "text", text: message }],
    }),
  );
};

/**
 * Registers `mcp_call` so an agent gets the catalog tool's own result, images and resources
 * included, rather than that result serialized as JSON text.
 */
export const registerMcpCall = Effect.fn("McpCatalogRegistration.registerMcpCall")(function* (
  decodeAsAdvertised: <Tools extends Record<string, Tool.Any>>(
    toolkit: Toolkit.Toolkit<Tools>,
  ) => Toolkit.Toolkit<Tools>,
) {
  const server = yield* McpServer.McpServer;
  const catalog = yield* McpCatalog.McpCatalog;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const built = yield* decodeAsAdvertised(McpCallToolkit);
  const tool = McpCallTool;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: advertisedJsonSchema(tool),
      annotations: {
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle("mcp_call", payload).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(McpCatalog.McpCatalog, catalog),
          Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.map(({ encodedResult }) => {
            const result = encodedResult as McpCallResult;
            return new McpSchema.CallToolResult({
              content: result.content,
              ...(result.structuredContent === undefined
                ? {}
                : { structuredContent: result.structuredContent }),
              isError: result.isError,
            });
          }),
          Effect.matchCauseEffect({ onFailure: callFailure, onSuccess: Effect.succeed }),
        );
      }),
  });
});
