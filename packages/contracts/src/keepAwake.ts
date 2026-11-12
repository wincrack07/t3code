import * as Schema from "effect/Schema";

export const KeepAwakeMode = Schema.Literals(["off", "agents", "duration", "until", "indefinite"]);
export const KeepAwakeOptions = Schema.Struct({
  allowDisplaySleep: Schema.Boolean,
  batteryCutoff: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  lidClosed: Schema.Boolean,
});
export type KeepAwakeOptions = typeof KeepAwakeOptions.Type;
export const TrayStatsSettings = Schema.Struct({
  enabled: Schema.Boolean,
  network: Schema.Boolean,
  cpu: Schema.Boolean,
  memory: Schema.Boolean,
  disk: Schema.Boolean,
});
export type TrayStatsSettings = typeof TrayStatsSettings.Type;
export const DEFAULT_TRAY_STATS: TrayStatsSettings = {
  enabled: true,
  network: true,
  cpu: true,
  memory: false,
  disk: false,
};
export const KeepAwakeDefaults = Schema.Struct({
  trayStats: Schema.optionalKey(TrayStatsSettings),
  mode: KeepAwakeMode,
  durationMinutes: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10080 })),
  untilTime: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  options: KeepAwakeOptions,
});
export type KeepAwakeDefaults = typeof KeepAwakeDefaults.Type;
export const DEFAULT_KEEP_AWAKE: KeepAwakeDefaults = {
  mode: "agents",
  durationMinutes: 60,
  untilTime: "18:00",
  options: { allowDisplaySleep: true, batteryCutoff: 20, lidClosed: false },
};
export const KeepAwakeSession = Schema.Union([
  Schema.Struct({ mode: Schema.Literals(["off", "agents", "indefinite"]) }),
  Schema.Struct({
    mode: Schema.Literal("duration"),
    minutes: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10080 })),
  }),
  Schema.Struct({ mode: Schema.Literal("until"), endsAt: Schema.Number.check(Schema.isFinite()) }),
]);
export type KeepAwakeSession = typeof KeepAwakeSession.Type;
export const KeepAwakeChange = Schema.Struct({
  session: Schema.optionalKey(KeepAwakeSession),
  options: Schema.optionalKey(KeepAwakeOptions),
  defaults: Schema.optionalKey(KeepAwakeDefaults),
});
export type KeepAwakeChange = typeof KeepAwakeChange.Type;
export const KeepAwakeLidStatus = Schema.Struct({
  authorized: Schema.Boolean,
  active: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  nativeAuthorization: Schema.Boolean,
  installCommand: Schema.String,
  removeCommand: Schema.String,
});
export type KeepAwakeLidStatus = typeof KeepAwakeLidStatus.Type;
export const KeepAwakeAuthorize = Schema.Struct({
  action: Schema.Literals(["install", "remove", "refresh"]),
});
export const KeepAwakeStatus = Schema.Struct({
  supported: Schema.Boolean,
  active: Schema.Boolean,
  mode: KeepAwakeMode,
  agents: Schema.Number,
  endsAt: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
  lidClosedSupported: Schema.Boolean,
  lid: Schema.optionalKey(KeepAwakeLidStatus),
  options: KeepAwakeOptions,
  defaults: KeepAwakeDefaults,
});
export type KeepAwakeStatus = typeof KeepAwakeStatus.Type;
