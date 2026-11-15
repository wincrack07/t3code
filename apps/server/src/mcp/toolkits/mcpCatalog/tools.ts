import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpCatalog from "../../../mcpCatalog/McpCatalog.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  McpCatalog.McpCatalog,
];

const McpToolsTool = Tool.make("mcp_tools", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
  description:
    "Find tools on the MCP servers in T3 Code's shared catalog, which every agent here can use without its own setup. Check it before saying you have no tool for an outside service. Search with words for the task, a tool name, or a server name; with no query it lists each server and its tool names. Run a match with `mcp_call`.",
  parameters: Schema.Struct({
    query: Schema.optionalKey(
      Schema.String.annotate({ description: "Words for the task, a tool, or a server." }),
    ),
    server: Schema.optionalKey(
      Schema.String.annotate({ description: "Only this server's tools." }),
    ),
  }),
  success: Schema.Struct({
    servers: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          state: Schema.String,
          error: Schema.NullOr(Schema.String),
          tools: Schema.Array(Schema.String),
        }),
      ),
    ),
    tools: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          server: Schema.String,
          name: Schema.String,
          description: Schema.String,
          readOnly: Schema.Boolean,
          inputSchema: Schema.Unknown,
        }),
      ),
    ),
    unavailable: Schema.optionalKey(
      Schema.Array(Schema.Struct({ server: Schema.String, error: Schema.String })),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

export const McpCallTool = Tool.make("mcp_call", {
  failure: OrchestratorMcpFailure,
  failureMode: "error",
  dependencies,
  description:
    "Run a tool from T3 Code's shared MCP catalog that `mcp_tools` found. `arguments` must match the tool's input schema. A tool that is not read-only needs a full-access caller.",
  parameters: Schema.Struct({
    server: Schema.String,
    tool: Schema.String,
    arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: Schema.Struct({
    content: Schema.Array(Schema.Unknown),
    structuredContent: Schema.optionalKey(Schema.Unknown),
    isError: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const McpToolsToolkit = Toolkit.make(McpToolsTool);
export const McpCallToolkit = Toolkit.make(McpCallTool);
