import * as Schema from "effect/Schema";

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
export const MachineMonitorSnapshot = Schema.Struct({
  sample: MachineSample,
  history: Schema.Array(MachineSample),
  processesAt: Schema.Number,
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
  limitations: Schema.Array(Schema.String),
});
export type MachineMonitorSnapshot = typeof MachineMonitorSnapshot.Type;
