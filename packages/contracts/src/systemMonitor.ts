import * as Schema from "effect/Schema";
import { ProjectId, ThreadId } from "./baseSchemas.ts";

export const MachineSample = Schema.Struct({
  at: Schema.Number,
  cpu: Schema.NullOr(Schema.Number),
  memoryUsed: Schema.Number,
  memoryAvailable: Schema.Number,
  memoryTotal: Schema.Number,
  pressure: Schema.Literals(["normal", "warning", "critical", "unknown"]),
  swapUsed: Schema.NullOr(Schema.Number),
  swapTotal: Schema.NullOr(Schema.Number),
  diskFree: Schema.NullOr(Schema.Number),
  diskTotal: Schema.NullOr(Schema.Number),
  networkDown: Schema.NullOr(Schema.Number),
  networkUp: Schema.NullOr(Schema.Number),
  load: Schema.Array(Schema.Number),
  uptime: Schema.Number,
});
export type MachineSample = typeof MachineSample.Type;
export const MachineProcess = Schema.Struct({
  pid: Schema.Number,
  ppid: Schema.Number,
  name: Schema.String,
  owner: Schema.NullOr(Schema.String),
  rss: Schema.Number,
  cpu: Schema.Number,
  cwd: Schema.NullOr(Schema.String),
});
export type MachineProcess = typeof MachineProcess.Type;
export const MachineProcessSnapshot = Schema.Struct({
  sampledAt: Schema.Number,
  topMemory: Schema.Array(MachineProcess),
  topCpu: Schema.Array(MachineProcess),
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      rss: Schema.Number,
      cpu: Schema.Number,
      count: Schema.Number,
    }),
  ),
  threads: Schema.Array(
    Schema.Struct({
      id: ThreadId,
      title: Schema.String,
      projectId: ProjectId,
      attribution: Schema.Literals(["cwd", "shared-directory"]),
      rss: Schema.NullOr(Schema.Number),
      cpu: Schema.NullOr(Schema.Number),
      count: Schema.NullOr(Schema.Number),
    }),
  ),
  limitations: Schema.Array(Schema.String),
});
export type MachineProcessSnapshot = typeof MachineProcessSnapshot.Type;
export const MachineMonitorSnapshot = Schema.Struct({
  sample: MachineSample,
  history: Schema.Array(MachineSample),
  limitations: Schema.Array(Schema.String),
  details: Schema.optionalKey(MachineProcessSnapshot),
});
export type MachineMonitorSnapshot = typeof MachineMonitorSnapshot.Type;
