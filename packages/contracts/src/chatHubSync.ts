import * as Schema from "effect/Schema";
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
