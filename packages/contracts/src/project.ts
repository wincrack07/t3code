import { RuntimeMode, ProviderInteractionMode } from "./providerPolicy.ts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { RepositoryIdentity, ThreadEnvMode } from "./environment.ts";
import { ChatAttachment, UploadChatAttachment } from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  CommandId,
  EnvironmentId,
  ForwardCompatibleUnion,
  isUnknownUnionMember,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunId,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
  type UnknownUnionMember,
} from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_SEARCH_CONTENTS_MAX_LIMIT = 500;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  runOnSettle: Schema.optional(Schema.Boolean),
  stopOnSettle: Schema.optional(Schema.Boolean),
  async: Schema.optional(Schema.Boolean),
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectIconColor = Schema.Literals([
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);
export type ProjectIconColor = typeof ProjectIconColor.Type;

const ProjectLucideIconName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);

const ProjectEmoji = TrimmedNonEmptyString.check(Schema.isMaxLength(32));

// Grapheme-count validation belongs to the server command boundary, not snapshot decoding.
export const ProjectMonogramText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(32),
  Schema.isPattern(/^[\p{L}\p{N}][\p{L}\p{N}\p{M}\u200c\u200d]*$/u),
);

const ProjectLucideIcon = Schema.Struct({
  kind: Schema.Literal("lucide"),
  name: ProjectLucideIconName,
  color: ProjectIconColor,
});
const ProjectEmojiIcon = Schema.Struct({
  kind: Schema.Literal("emoji"),
  emoji: ProjectEmoji,
});
const ProjectMonogramIcon = Schema.Struct({
  kind: Schema.Literal("monogram"),
  text: ProjectMonogramText,
  color: ProjectIconColor,
});
export const ProjectFaviconPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1024),
  Schema.isPattern(/\.(?:avif|gif|icns|ico|jpe?g|png|svg|webp)$/i),
);
export type ProjectFaviconPath = typeof ProjectFaviconPath.Type;

export const ProjectIconOverride = Schema.Union([
  ProjectLucideIcon,
  ProjectEmojiIcon,
  ProjectMonogramIcon,
]);
export type ProjectIconOverride = typeof ProjectIconOverride.Type;

const ProjectLucideIconWithLegacyMonogram = Schema.Struct({
  ...ProjectLucideIcon.fields,
  monogramText: Schema.optional(ProjectMonogramText),
  monogram: Schema.optional(ProjectMonogramText),
});
const projectIconMembers = [
  ProjectLucideIconWithLegacyMonogram,
  ProjectEmojiIcon,
  ProjectMonogramIcon,
] as const;
type ProjectIconMember = (typeof projectIconMembers)[number]["Type"];

const fromLegacyMonogram = (icon: ProjectIconMember): ProjectIconOverride => {
  if (icon.kind !== "lucide") return icon;
  const text = icon.monogramText ?? icon.monogram;
  return text === undefined
    ? { kind: "lucide", name: icon.name, color: icon.color }
    : { kind: "monogram", text, color: icon.color };
};

export const StoredProjectIcon = Schema.Union(projectIconMembers).pipe(
  Schema.decodeTo(
    Schema.toType(ProjectIconOverride),
    SchemaTransformation.transform<ProjectIconOverride, ProjectIconMember>({
      decode: fromLegacyMonogram,
      encode: (icon) => icon,
    }),
  ),
);

export const ReceivedProjectIcon = ForwardCompatibleUnion(projectIconMembers, "kind").pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.toType(ProjectIconOverride)),
    SchemaTransformation.transform<
      ProjectIconOverride | null,
      ProjectIconMember | UnknownUnionMember<"kind">
    >({
      decode: (icon) => (isUnknownUnionMember(icon) ? null : fromLegacyMonogram(icon)),
      encode: (icon) => icon as ProjectIconMember,
    }),
  ),
);

export const SavedPromptStatus = Schema.Literals(["open", "in-progress", "review", "done"]);
export type SavedPromptStatus = typeof SavedPromptStatus.Type;
const SavedPromptTitle = Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(160)));

export const TaskReviewSnapshot = Schema.Struct({
  runId: RunId,
  userMessageId: MessageId,
  outcome: Schema.Literals(["completed", "failed", "interrupted", "waiting for input"]),
  finishedAt: IsoDateTime,
  durationMs: Schema.optional(NonNegativeInt),
  assistantMessage: Schema.optional(Schema.String.check(Schema.isMaxLength(8000))),
  changes: Schema.optional(
    Schema.Struct({ count: NonNegativeInt, additions: NonNegativeInt, deletions: NonNegativeInt }),
  ),
  pullRequests: Schema.Array(
    Schema.Struct({
      number: PositiveInt,
      url: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
      state: Schema.optional(Schema.Literals(["open", "closed", "merged"])),
    }),
  ).check(Schema.isMaxLength(10)),
});
export type TaskReviewSnapshot = typeof TaskReviewSnapshot.Type;

export const TaskRunSettings = Schema.Struct({
  defaultModelSelection: Schema.optional(ModelSelection),
  targetEnvironmentId: Schema.optional(EnvironmentId),
  threadEnvMode: Schema.optional(ThreadEnvMode),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type TaskRunSettings = typeof TaskRunSettings.Type;
const TaskBriefFields = {
  runSettings: Schema.optional(Schema.NullOr(TaskRunSettings)),
  parentTaskId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  acceptanceCriteria: Schema.optional(
    Schema.Array(
      Schema.Struct({
        text: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
        done: Schema.Boolean,
      }),
    ).check(Schema.isMaxLength(20)),
  ),
};

const TaskInboxFields = {
  priority: Schema.optional(Schema.Literals(["p1", "p2", "p3"])),
  tags: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(32))).check(Schema.isMaxLength(12)),
  ),
  when: Schema.optional(Schema.Literals(["today", "later", "none"])),
};

export const ProjectTaskAttachment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("reference"),
    path: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
    temporary: Schema.Boolean,
    sizeBytes: Schema.optional(NonNegativeInt),
    isDirectory: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ kind: Schema.Literal("stored"), attachment: ChatAttachment }),
]);
export type ProjectTaskAttachment = typeof ProjectTaskAttachment.Type;
export const taskAttachmentKey = (item: ProjectTaskAttachment) =>
  item.kind === "reference" ? item.path : item.attachment.id;
export const TaskAttachmentInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("path"),
    path: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  }),
  Schema.Struct({
    kind: Schema.Literal("upload"),
    attachment: Schema.Union([UploadChatAttachment, ChatAttachment]),
  }),
]);
export type TaskAttachmentInput = typeof TaskAttachmentInput.Type;
export const TaskAttachmentsInput = Schema.Struct({
  includePrompt: Schema.optional(Schema.Boolean),
  projectId: ProjectId,
  taskId: TrimmedNonEmptyString,
});
export type TaskAttachmentsInput = typeof TaskAttachmentsInput.Type;
export const TaskAttachmentMetadata = Schema.Struct({
  warning: Schema.NullOr(Schema.String),
  key: Schema.String,
  attachment: ProjectTaskAttachment,
  missing: Schema.Boolean,
  sizeBytes: NonNegativeInt,
  isDirectory: Schema.Boolean,
});
export type TaskAttachmentMetadata = typeof TaskAttachmentMetadata.Type;
export class TaskAttachmentError extends Schema.TaggedError<TaskAttachmentError>()(
  "TaskAttachmentError",
  {
    reason: Schema.Literals([
      "invalid-path",
      "source-missing",
      "invalid-size",
      "limit",
      "storage",
      "task-missing",
    ]),
    message: Schema.String,
  },
) {}
export class TaskAttachmentsHomeOnlyError extends Schema.TaggedError<TaskAttachmentsHomeOnlyError>()(
  "TaskAttachmentsHomeOnlyError",
  { homeEnvironmentId: EnvironmentId },
) {
  override get message() {
    return `Attachments must be sent from ${this.homeEnvironmentId}.`;
  }
}
const TaskAttachmentInputs = Schema.Array(TaskAttachmentInput).check(Schema.isMaxLength(8));

export const ProjectSavedPrompt = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(120000)),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  title: Schema.optional(SavedPromptTitle),
  status: Schema.optional(SavedPromptStatus),
  ...TaskInboxFields,
  ...TaskBriefFields,
  deletedAt: Schema.optional(IsoDateTime),
  latestThreadId: Schema.optional(ThreadId),
  latestUserMessageId: Schema.optional(MessageId),
  review: Schema.optional(TaskReviewSnapshot),
  latestThreadEnvironmentId: Schema.optional(EnvironmentId),
  threadLinks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        userMessageId: Schema.optional(MessageId),
        snapshot: Schema.optional(TaskReviewSnapshot),
        environmentId: Schema.optional(EnvironmentId),
      }),
    ).check(Schema.isMaxLength(10)),
  ),
  attachments: Schema.optional(Schema.Array(ProjectTaskAttachment).check(Schema.isMaxLength(8))),
});
export type ProjectSavedPrompt = typeof ProjectSavedPrompt.Type;
export const TaskBatchSource = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  taskId: TrimmedNonEmptyString,
});
const TaskBatchLaunchSettings = Schema.Struct({
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  threadEnvMode: Schema.optional(ThreadEnvMode),
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
const TaskBatchSubmission = Schema.Struct({
  source: TaskBatchSource,
  brief: ProjectSavedPrompt,
  destination: Schema.optional(
    Schema.Struct({ environmentId: EnvironmentId, projectId: ProjectId }),
  ),
  launch: TaskBatchLaunchSettings,
  overrides: Schema.optional(TaskRunSettings),
  fallback: Schema.optional(TaskBatchLaunchSettings),
});
export const TaskBatchEntry = Schema.Struct({
  expectedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  expectedUserMessageId: Schema.optional(Schema.NullOr(MessageId)),
  ...TaskBatchSubmission.fields,
  brief: Schema.optional(ProjectSavedPrompt),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  id: TrimmedNonEmptyString,
  commandId: CommandId,
  threadId: ThreadId,
  userMessageId: MessageId,
  runId: Schema.optional(RunId),
  state: Schema.Literals([
    "queued",
    "starting",
    "running",
    "settled",
    "cancelled",
    "failed-to-start",
  ]),
  failureReason: Schema.optional(
    Schema.Literals(["settings-changed", "task-changed", "source-deleted", "source-unverifiable"]),
  ),
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  snapshot: Schema.optional(TaskReviewSnapshot),
});
export type TaskBatchEntry = typeof TaskBatchEntry.Type;
export const ProjectTaskBatch = Schema.Struct({
  id: CommandId,
  concurrency: PositiveInt.check(Schema.isLessThanOrEqualTo(4)),
  startSequence: Schema.optional(PositiveInt),
  effectiveConcurrency: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(4))),
  createdAt: IsoDateTime,
  entries: Schema.Array(TaskBatchEntry).check(Schema.isMaxLength(100)),
});
export type ProjectTaskBatch = typeof ProjectTaskBatch.Type;
export const ProjectTaskBatches = Schema.Array(ProjectTaskBatch).check(Schema.isMaxLength(10));
export const TaskBatchStartInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  concurrency: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(4))),
  entries: Schema.Array(TaskBatchSubmission).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export type TaskBatchStartInput = typeof TaskBatchStartInput.Type;
export const TaskBatchCancelInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  batchId: CommandId,
  entryId: Schema.optional(TrimmedNonEmptyString),
});
export type TaskBatchCancelInput = typeof TaskBatchCancelInput.Type;
export class TaskBatchError extends Schema.TaggedError<TaskBatchError>()("TaskBatchError", {
  operation: Schema.Literals(["start", "cancel", "pump"]),
  projectId: Schema.optional(ProjectId),
  reason: Schema.Literals([
    "invalid-input",
    "capacity",
    "missing-project",
    "missing-batch",
    "home-only-attachments",
    "persistence",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-input":
        return "Invalid batch input. Select unique tasks and a concurrency limit from 1 to 4.";
      case "capacity":
        return "The environment queue is full (100 pending tasks and 200000 prompt characters maximum).";
      case "missing-project":
        return "The destination project is unavailable.";
      case "missing-batch":
        return "The batch or queue entry is unavailable.";
      case "home-only-attachments":
        return "Tasks with stored attachments must run on their home environment.";
      case "persistence":
        return "The task queue could not be updated.";
    }
  }
}

export const TaskAttachmentListResult = Schema.Struct({
  task: Schema.optional(ProjectSavedPrompt),
  attachments: Schema.Array(TaskAttachmentMetadata),
});
export type TaskAttachmentListResult = typeof TaskAttachmentListResult.Type;

const TaskAddFields = {
  id: TrimmedNonEmptyString,
  text: ProjectSavedPrompt.fields.text,
  title: Schema.optional(SavedPromptTitle),
  status: Schema.optional(SavedPromptStatus),
  ...TaskInboxFields,
  ...TaskBriefFields,
};
const TaskAddPosition = Schema.optional(Schema.Literals(["start", "end"]));

export const SavedPromptAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("review"),
    id: TrimmedNonEmptyString,
    threadId: ThreadId,
    environmentId: Schema.optional(EnvironmentId),
    snapshot: TaskReviewSnapshot,
  }),
  Schema.Struct({ kind: Schema.Literal("approve"), id: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("request-changes"),
    id: TrimmedNonEmptyString,
    threadId: ThreadId,
    environmentId: Schema.optional(EnvironmentId),
    userMessageId: MessageId,
  }),
  Schema.Struct({
    kind: Schema.Literal("reorder"),
    ids: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(100)),
  }),
  Schema.Struct({
    kind: Schema.Literal("add"),
    ...TaskAddFields,
    attachments: Schema.optional(TaskAttachmentInputs),
    position: TaskAddPosition,
  }),
  Schema.Struct({
    kind: Schema.Literal("add-many"),
    tasks: Schema.Array(Schema.Struct(TaskAddFields)).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100),
    ),
    position: TaskAddPosition,
  }),
  Schema.Struct({
    kind: Schema.Literal("edit"),
    id: TrimmedNonEmptyString,
    text: Schema.optional(ProjectSavedPrompt.fields.text),
    title: Schema.optional(SavedPromptTitle),
    status: Schema.optional(SavedPromptStatus),
    ...TaskInboxFields,
    ...TaskBriefFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("complete"),
    id: TrimmedNonEmptyString,
    done: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("delete"), id: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("restore"), id: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("link"),
    expectedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
    expectedUserMessageId: Schema.optional(Schema.NullOr(MessageId)),
    userMessageId: Schema.optional(MessageId),
    id: TrimmedNonEmptyString,
    threadId: ThreadId,
    environmentId: Schema.optional(EnvironmentId),
  }),
  Schema.Struct({
    kind: Schema.Literal("attach"),
    id: TrimmedNonEmptyString,
    attachments: TaskAttachmentInputs,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-attachment"),
    id: TrimmedNonEmptyString,
    key: TrimmedNonEmptyString,
  }),
  Schema.Struct({ kind: Schema.Literal("clear-done") }),
]);
export type SavedPromptAction = typeof SavedPromptAction.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectIcon: Schema.optional(Schema.NullOr(ReceivedProjectIcon)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  // Opt-in because background sync performs network I/O and may move the checkout.
  autoPull: Schema.optional(Schema.Boolean),
  scripts: Schema.Array(ProjectScript),
  savedPrompts: Schema.optional(Schema.Array(ProjectSavedPrompt)),
  taskBatches: Schema.optional(ProjectTaskBatches),
  pinnedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type Project = typeof Project.Type;

export const ProjectSnapshot = Schema.Struct({
  projects: Schema.Array(Project),
  updatedAt: IsoDateTime,
});
export type ProjectSnapshot = typeof ProjectSnapshot.Type;

export const ProjectCreatePayload = Schema.Struct({
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});
export type ProjectCreatePayload = typeof ProjectCreatePayload.Type;

export const ProjectUpdatePayload = Schema.Struct({
  savedPrompt: Schema.optional(SavedPromptAction),
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  autoPull: Schema.optional(Schema.Boolean),
  projectIcon: Schema.optional(Schema.NullOr(ProjectIconOverride)),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  pinned: Schema.optional(Schema.Boolean),
  archived: Schema.optional(
    Schema.Boolean.annotate({
      description: "Threads and files are kept.",
    }),
  ),
});
export type ProjectUpdatePayload = typeof ProjectUpdatePayload.Type;

export const ProjectMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("project.create"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectCreatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.update"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectUpdatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.delete"),
    commandId: CommandId,
    projectId: ProjectId,
    force: Schema.optional(Schema.Boolean),
  }),
]);
export type ProjectMutation = typeof ProjectMutation.Type;

export class ProjectMutationError extends Schema.TaggedError<ProjectMutationError>()(
  "ProjectMutationError",
  {
    commandId: CommandId,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ProjectEntryKind = Schema.Literals(["file", "directory"]);
export type ProjectEntryKind = typeof ProjectEntryKind.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
  kind: Schema.optional(ProjectEntryKind),
  imageOnly: Schema.optional(Schema.Boolean),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  ignored: Schema.optional(Schema.Boolean),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectSearchContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Preserve whitespace because it is significant in content queries.
  query: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_CONTENTS_MAX_LIMIT)),
  caseSensitive: Schema.Boolean,
  wholeWord: Schema.Boolean,
  useRegex: Schema.Boolean,
});
export type ProjectSearchContentsInput = typeof ProjectSearchContentsInput.Type;

export const ProjectContentMatchRange = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
});
export type ProjectContentMatchRange = typeof ProjectContentMatchRange.Type;

export const ProjectContentMatch = Schema.Struct({
  path: TrimmedNonEmptyString,
  lineNumber: PositiveInt,
  lineContent: Schema.String,
  matchRanges: Schema.Array(ProjectContentMatchRange),
});
export type ProjectContentMatch = typeof ProjectContentMatch.Type;

export const ProjectSearchContentsResult = Schema.Struct({
  matches: Schema.Array(ProjectContentMatch),
  truncated: Schema.Boolean,
  regexFallbackError: Schema.optional(Schema.String),
});
export type ProjectSearchContentsResult = typeof ProjectSearchContentsResult.Type;

export const ProjectListEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  directoryPath: Schema.optional(TrimmedString),
});
export type ProjectListEntriesInput = typeof ProjectListEntriesInput.Type;

export const ProjectListEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectListEntriesResult = typeof ProjectListEntriesResult.Type;

// Untracked files git ignores. Wholly ignored folders such as `node_modules`
// are left out, so the list stays small enough to pick from.
export const ProjectListIgnoredFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectListIgnoredFilesInput = typeof ProjectListIgnoredFilesInput.Type;

export const ProjectIgnoredFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  byteLength: NonNegativeInt,
});
export type ProjectIgnoredFile = typeof ProjectIgnoredFile.Type;

export const ProjectListIgnoredFilesResult = Schema.Struct({
  files: Schema.Array(ProjectIgnoredFile),
  truncated: Schema.Boolean,
});
export type ProjectListIgnoredFilesResult = typeof ProjectListIgnoredFilesResult.Type;

export const ProjectEntriesFailure = Schema.Literals([
  "workspace_root_not_found",
  "workspace_root_create_failed",
  "workspace_root_stat_failed",
  "workspace_root_not_directory",
  "search_index_create_failed",
  "search_index_scan_timed_out",
  "search_index_search_failed",
  "directory_list_failed",
]);
export type ProjectEntriesFailure = typeof ProjectEntriesFailure.Type;

type ProjectEntriesFailureContext = {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
  readonly cause?: unknown;
};

function decodedProjectErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class ProjectSearchEntriesError extends Schema.TaggedError<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: ProjectEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to search workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export class ProjectSearchContentsError extends Schema.TaggedError<ProjectSearchContentsError>()(
  "ProjectSearchContentsError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: ProjectEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to search workspace contents in '${props.cwd}'.`,
    } as any);
  }
}

export class ProjectListEntriesError extends Schema.TaggedError<ProjectListEntriesError>()(
  "ProjectListEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectEntriesFailureContext & { readonly cwd: string }) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ?? `Failed to list workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Workspace-relative or absolute host path; only workspace-relative paths are writable.
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
  // Optional files can be absent without failing the read.
  allowMissing: Schema.optional(Schema.Boolean),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  byteLength: NonNegativeInt,
  truncated: Schema.Boolean,
  // Omitted by older servers; false only for an absent optional file.
  exists: Schema.optional(Schema.Boolean),
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export const ProjectFileFailure = Schema.Literals([
  "workspace_path_outside_root",
  "resolved_path_outside_root",
  "path_not_file",
  "binary_file",
  "operation_failed",
]);
export type ProjectFileFailure = typeof ProjectFileFailure.Type;

export const ProjectFileOperation = Schema.Literals([
  "realpath-workspace-root",
  "realpath-target",
  "open",
  "stat",
  "read",
  "close",
  "make-directory",
  "write-file",
]);
export type ProjectFileOperation = typeof ProjectFileOperation.Type;

type ProjectFileFailureContext = {
  readonly cwd: string;
  readonly relativePath: string;
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
  readonly cause?: unknown;
};

export class ProjectReadFileError extends Schema.TaggedError<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to read workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const ProjectEnsureScratchResult = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectEnsureScratchResult = typeof ProjectEnsureScratchResult.Type;

export const ProjectCreateNewInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type ProjectCreateNewInput = typeof ProjectCreateNewInput.Type;

export const ProjectCreateNewResult = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  /** The project and its files exist either way. */
  commitError: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectCreateNewResult = typeof ProjectCreateNewResult.Type;

export const ProjectCreateFromThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProjectCreateFromThreadInput = typeof ProjectCreateFromThreadInput.Type;

export const ProjectCreateFromThreadResult = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectCreateFromThreadResult = typeof ProjectCreateFromThreadResult.Type;

export class ProjectWriteFileError extends Schema.TaggedError<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to write workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}
