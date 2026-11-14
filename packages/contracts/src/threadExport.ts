import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId } from "./baseSchemas.ts";

const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    { expected: "an ISO timestamp" },
  ),
);
const Metadata = Schema.String.check(Schema.isMaxLength(8192));
export const T3ThreadExport = Schema.Struct({
  format: Schema.Literal("t3code.thread"),
  version: Schema.Literal(1),
  threadId: Metadata,
  title: Metadata,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  source: Schema.Struct({ environmentId: Metadata, label: Metadata }),
  project: Schema.Struct({
    title: Metadata,
    workspacePath: Metadata,
    // Paths differ across machines; the repository is what identifies a project. Optional for older files.
    repository: Schema.optional(
      Schema.Struct({ canonicalKey: Metadata, displayName: Schema.optional(Metadata) }),
    ),
  }),
  provider: Metadata,
  model: Metadata,
  conversation: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant", "plan"]),
      text: Schema.String,
      timestamp: Timestamp,
      attachments: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  ),
});
export type T3ThreadExport = typeof T3ThreadExport.Type;

export const T3ThreadExportResult = Schema.Struct({
  bundle: T3ThreadExport,
  meta: Schema.Struct({
    environmentId: Metadata,
    environmentLabel: Schema.String,
    threadId: Metadata,
    title: Metadata,
    projectTitle: Schema.NullOr(Schema.String),
    workspaceRoot: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    archived: Schema.Boolean,
    deletedAt: Schema.NullOr(Schema.String),
    messageCount: Schema.Number,
  }),
});
export type T3ThreadExportResult = typeof T3ThreadExportResult.Type;

export const T3ThreadImportResult = Schema.Struct({
  sequence: NonNegativeInt,
  // Set when this chat was imported before; older servers omit it.
  existing: Schema.optional(Schema.Struct({ projectId: ProjectId, deleted: Schema.Boolean })),
});
export type T3ThreadImportResult = typeof T3ThreadImportResult.Type;
