import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** How agents name the server in `mcp_call`, so it stays short and plain. */
export const McpCatalogServerId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,39}$/),
);
export type McpCatalogServerId = typeof McpCatalogServerId.Type;

/** An environment variable for a command, or a header for a URL. */
export const McpCatalogVariable = Schema.Struct({
  name: TrimmedNonEmptyString,
  value: Schema.String,
  secret: Schema.Boolean,
  // A secret's value stays on the server; clients see it blank with `stored` set.
  stored: Schema.optionalKey(Schema.Boolean),
});
export type McpCatalogVariable = typeof McpCatalogVariable.Type;

export const McpCatalogTransport = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String),
    cwd: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
  }),
]);
export type McpCatalogTransport = typeof McpCatalogTransport.Type;

export const McpCatalogServer = Schema.Struct({
  id: McpCatalogServerId,
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  transport: McpCatalogTransport,
  env: Schema.Array(McpCatalogVariable),
  headers: Schema.Array(McpCatalogVariable),
});
export type McpCatalogServer = typeof McpCatalogServer.Type;

export const McpCatalogTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  readOnly: Schema.Boolean,
});
export type McpCatalogTool = typeof McpCatalogTool.Type;

export const McpCatalogServerState = Schema.Literals([
  "disabled",
  "idle",
  "connecting",
  "connected",
  "error",
]);
export type McpCatalogServerState = typeof McpCatalogServerState.Type;

export const McpCatalogServerStatus = Schema.Struct({
  id: McpCatalogServerId,
  state: McpCatalogServerState,
  error: Schema.NullOr(Schema.String),
  tools: Schema.Array(McpCatalogTool),
  serverVersion: Schema.NullOr(Schema.String),
});
export type McpCatalogServerStatus = typeof McpCatalogServerStatus.Type;

export const McpCatalogSnapshot = Schema.Struct({
  servers: Schema.Array(McpCatalogServer),
  statuses: Schema.Array(McpCatalogServerStatus),
});
export type McpCatalogSnapshot = typeof McpCatalogSnapshot.Type;

export const McpCatalogUpsertInput = Schema.Struct({
  // Set when an edit renames the server.
  previousId: Schema.optionalKey(McpCatalogServerId),
  server: McpCatalogServer,
});
export type McpCatalogUpsertInput = typeof McpCatalogUpsertInput.Type;

export const McpCatalogServerRef = Schema.Struct({ id: McpCatalogServerId });

export const McpCatalogImportSource = Schema.Literals([
  "claude",
  "claude-desktop",
  "codex",
  "cursor",
]);
export type McpCatalogImportSource = typeof McpCatalogImportSource.Type;

export const McpCatalogImportCandidate = Schema.Struct({
  source: McpCatalogImportSource,
  server: McpCatalogServer,
  // The catalog already holds a server with this id.
  exists: Schema.Boolean,
});
export type McpCatalogImportCandidate = typeof McpCatalogImportCandidate.Type;

export const McpCatalogImportInput = Schema.Struct({
  items: Schema.Array(Schema.Struct({ source: McpCatalogImportSource, id: McpCatalogServerId })),
});
export type McpCatalogImportInput = typeof McpCatalogImportInput.Type;

export class McpCatalogError extends Schema.TaggedError<McpCatalogError>()("McpCatalogError", {
  message: Schema.String,
}) {}
