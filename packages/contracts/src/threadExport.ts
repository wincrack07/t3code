import * as Schema from "effect/Schema";

export const T3ThreadExport = Schema.Struct({
  format: Schema.Literal("t3code.thread"),
  version: Schema.Literal(1),
  threadId: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  source: Schema.Struct({ environmentId: Schema.String, label: Schema.String }),
  project: Schema.Struct({ title: Schema.String, workspacePath: Schema.String }),
  provider: Schema.String,
  model: Schema.String,
  conversation: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant", "plan"]),
      text: Schema.String,
      timestamp: Schema.String,
      attachments: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  ),
});
export type T3ThreadExport = typeof T3ThreadExport.Type;

export const T3ThreadExportResult = Schema.Struct({
  bundle: T3ThreadExport,
  meta: Schema.Struct({
    environmentId: Schema.String,
    environmentLabel: Schema.String,
    threadId: Schema.String,
    title: Schema.String,
    projectTitle: Schema.NullOr(Schema.String),
    workspaceRoot: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
    archived: Schema.Boolean,
    deletedAt: Schema.NullOr(Schema.String),
    messageCount: Schema.Number,
  }),
});
export type T3ThreadExportResult = typeof T3ThreadExportResult.Type;
