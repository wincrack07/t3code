import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

export const MachineCleanupSettings = Schema.Struct({
  projectRoots: Schema.Array(Schema.String),
  protectedPaths: Schema.Array(Schema.String),
  inactivityDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3650 })),
  enabledRules: Schema.Array(Schema.String),
  scheduleEnabled: Schema.Boolean,
  scheduleTime: Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)),
  lowSpaceGiB: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 10000 })),
});
export type MachineCleanupSettings = typeof MachineCleanupSettings.Type;
export const DEFAULT_MACHINE_CLEANUP_SETTINGS: MachineCleanupSettings = {
  projectRoots: [],
  protectedPaths: [],
  inactivityDays: 7,
  enabledRules: ["*"],
  scheduleEnabled: false,
  scheduleTime: "06:00",
  lowSpaceGiB: 10,
};
export const MachineCleanupSettingsWithDefault = MachineCleanupSettings.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_MACHINE_CLEANUP_SETTINGS)),
);
export const MachineCleanupItem = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  rule: Schema.String,
  phase: Schema.Literals(["A", "B", "C"]),
  bytes: Schema.Number,
  effect: Schema.String,
  probablyActive: Schema.Boolean,
  outcome: Schema.Literals(["pending", "removed", "skipped", "protected", "dirty", "failed"]),
  reason: Schema.String,
  project: Schema.String,
  branch: Schema.NullOr(Schema.String),
  changes: Schema.Number,
  head: Schema.NullOr(Schema.String),
});
export type MachineCleanupItem = typeof MachineCleanupItem.Type;
export const TaskAttachmentUsage = Schema.Struct({
  open: Schema.Struct({ count: Schema.Number, bytes: Schema.Number }),
  done: Schema.Struct({ count: Schema.Number, bytes: Schema.Number }),
  orphaned: Schema.Struct({ count: Schema.Number, bytes: Schema.Number }),
});
export type TaskAttachmentUsage = typeof TaskAttachmentUsage.Type;
export const MachineCleanupReport = Schema.Struct({
  taskAttachments: Schema.optional(TaskAttachmentUsage),
  id: Schema.String,
  mode: Schema.Literals(["scan", "phaseA", "phaseB", "phaseC", "unattended"]),
  platform: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  measurements: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        phase: Schema.Literals(["A", "B", "C"]),
        itemId: Schema.String,
        before: Schema.Number,
        after: Schema.Number,
      }),
    ),
  ),
  measurementPath: Schema.String,
  freeBefore: Schema.Number,
  freeAfter: Schema.Number,
  items: Schema.Array(MachineCleanupItem),
  notes: Schema.Array(Schema.String),
});
export type MachineCleanupReport = typeof MachineCleanupReport.Type;
export const MachineCleanupState = Schema.Struct({
  freeNow: Schema.optionalKey(Schema.Number),
  measuredAt: Schema.optionalKey(Schema.String),
  running: Schema.Boolean,
  progress: Schema.String,
  report: Schema.NullOr(MachineCleanupReport),
  history: Schema.Array(MachineCleanupReport),
});
export type MachineCleanupState = typeof MachineCleanupState.Type;
export const MachineCleanupSelection = Schema.Struct({
  reportId: Schema.String,
  itemIds: Schema.Array(Schema.String),
});
export type MachineCleanupSelection = typeof MachineCleanupSelection.Type;
export class MachineCleanupError extends Schema.TaggedError<MachineCleanupError>()(
  "MachineCleanupError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.operation === "unsupported-platform"
      ? "Machine cleanup is not supported on Windows."
      : `Machine cleanup ${this.operation} failed.`;
  }
}

export const MachineCleanupAgentInput = Schema.Struct({
  action: Schema.Literals(["scan", "phaseA", "status", "requestApproval"]),
  phase: Schema.optionalKey(Schema.Literals(["B", "C"])),
});
