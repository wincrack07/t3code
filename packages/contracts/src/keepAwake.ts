import * as Schema from "effect/Schema";

export const KeepAwakeMode = Schema.Literals(["off", "agents", "duration", "until", "indefinite"]);
export const KeepAwakeOptions = Schema.Struct({
  allowDisplaySleep: Schema.Boolean,
  batteryCutoff: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  lidClosed: Schema.Boolean,
});
export type KeepAwakeOptions = typeof KeepAwakeOptions.Type;
export const KeepAwakeDefaults = Schema.Struct({
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
export const KeepAwakeStatus = Schema.Struct({
  supported: Schema.Boolean,
  active: Schema.Boolean,
  mode: KeepAwakeMode,
  agents: Schema.Number,
  endsAt: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
  lidClosedSupported: Schema.Boolean,
  options: KeepAwakeOptions,
  defaults: KeepAwakeDefaults,
});
export type KeepAwakeStatus = typeof KeepAwakeStatus.Type;
