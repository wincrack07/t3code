import * as Schema from "effect/Schema";

// T3 ids include `:` and `%` (e.g. `mcp:launch:<hex>`); clients percent-encode path segments.
export const CHAT_HUB_ID_PATTERN = /^[A-Za-z0-9_.:%~-]{1,1024}$/;
const Id = Schema.String.check(Schema.isPattern(CHAT_HUB_ID_PATTERN));
const Timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
);
export const ChatHubMeta = Schema.Struct({
  environmentId: Id,
  environmentLabel: Schema.String,
  threadId: Id,
  title: Schema.String,
  projectTitle: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  archived: Schema.Boolean,
  deletedAt: Schema.NullOr(Timestamp),
  messageCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ChatHubMeta = typeof ChatHubMeta.Type;
export const ChatHubPut = Schema.Struct({
  meta: ChatHubMeta,
  markdown: Schema.String,
  bundle: Schema.Json,
});
export const ChatHubTokenInput = Schema.Struct({
  label: Schema.String,
  scope: Schema.Literals(["write", "read"]),
});
export const ChatHubTokenCreated = Schema.Struct({ id: Schema.String, token: Schema.String });
export const ChatHubToken = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  scope: Schema.Literals(["write", "read"]),
  created_at: Timestamp,
  last_used_at: Schema.NullOr(Timestamp),
  revoked_at: Schema.NullOr(Timestamp),
});
export const ChatHubTokens = Schema.Struct({ items: Schema.Array(ChatHubToken) });
export const ChatHubStored = Schema.Struct({ stored: Schema.Boolean });
export const ChatHubThread = Schema.Struct({ meta: ChatHubMeta, bundle: Schema.Json });
export const ChatHubList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ ...ChatHubMeta.fields, snippet: Schema.optional(Schema.String) }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});
export const ChatHubEnvironments = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      environmentId: Id,
      environmentLabel: Schema.String,
      threadCount: Schema.Int,
      updatedAt: Timestamp,
    }),
  ),
});
export const ChatHubHealth = Schema.Struct({ ok: Schema.Literal(true), version: Schema.String });
export const ChatHubError = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});
export const ChatHubDeleted = Schema.Struct({ deleted: Schema.Boolean });

export const ChatHubRevoked = Schema.Struct({ revoked: Schema.Boolean });

export const ChatHubStatus = Schema.Struct({
  url: Schema.String,
  enabled: Schema.Boolean,
  configured: Schema.Boolean,
  lastSuccess: Schema.NullOr(Schema.String),
  pendingCount: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
});
export const ChatHubConfigure = Schema.Struct({
  url: Schema.String,
  enabled: Schema.Boolean,
  token: Schema.optional(Schema.String),
});
export const ChatHubQuery = Schema.Struct({
  q: Schema.optional(Schema.String),
  environmentId: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  includeArchived: Schema.optional(Schema.Boolean),
});
export const ChatHubLookup = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
});
export class ChatHubSyncError extends Schema.TaggedError<ChatHubSyncError>()("ChatHubSyncError", {
  operation: Schema.String,
}) {
  override get message() {
    return `Chat hub ${this.operation} failed. Check the URL, token and connection.`;
  }
}
