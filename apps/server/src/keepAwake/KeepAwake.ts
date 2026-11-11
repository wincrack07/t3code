import * as LidSleep from "./LidSleep.ts";
import {
  type KeepAwakeChange,
  type KeepAwakeDefaults,
  type KeepAwakeSession,
  type KeepAwakeStatus,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SleepInhibitor from "./SleepInhibitor.ts";

export class KeepAwakePreferences extends Context.Service<
  KeepAwakePreferences,
  {
    readonly load: Effect.Effect<KeepAwakeDefaults>;
    readonly save: (
      defaults: KeepAwakeDefaults,
    ) => Effect.Effect<void, PlatformError.PlatformError | Schema.SchemaError>;
  }
>()("t3/keepAwake/KeepAwake/KeepAwakePreferences") {}

export class KeepAwake extends Context.Service<
  KeepAwake,
  {
    readonly status: Effect.Effect<KeepAwakeStatus>;
    readonly changes: Stream.Stream<KeepAwakeStatus>;
    readonly change: (input: KeepAwakeChange) => Effect.Effect<KeepAwakeStatus>;
    readonly authorizeLid: (
      action: "install" | "remove" | "refresh",
    ) => Effect.Effect<KeepAwakeStatus>;
    readonly agentsChanged: (count: number) => Effect.Effect<void>;
  }
>()("t3/keepAwake/KeepAwake") {}

function nextUntilTime(time: string, now: number) {
  const date = DateTime.toDateUtc(DateTime.makeUnsafe(now));
  const [hours, minutes] = time.split(":").map(Number);
  date.setHours(hours ?? 18, minutes ?? 0, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}

const make = Effect.gen(function* () {
  const lid = yield* LidSleep.LidSleep;
  const inhibitor = yield* SleepInhibitor.SleepInhibitor;
  const preferences = yield* KeepAwakePreferences;
  const defaults = yield* preferences.load;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const state = yield* SubscriptionRef.make<KeepAwakeStatus>({
    supported: inhibitor.supported,
    active: false,
    mode: "off",
    agents: 0,
    endsAt: null,
    reason: inhibitor.supported ? null : "Sleep inhibition is not supported on this host.",
    lidClosedSupported: inhibitor.lidClosedSupported,
    lid: yield* lid.status,
    options: defaults.options,
    defaults,
  });
  yield* lid.changes.pipe(
    Stream.runForEach((status) => SubscriptionRef.update(state, (s) => ({ ...s, lid: status }))),
    Effect.forkIn(scope),
  );
  let lease: Scope.Closeable | undefined;
  let expiry: Fiber.Fiber<void> | undefined;
  let idle: Fiber.Fiber<void> | undefined;
  let battery: Fiber.Fiber<void> | undefined;
  const stop = Effect.fn("KeepAwake.release")(function* () {
    yield* lid.restore.pipe(Effect.ignore);
    if (lease) {
      const current = lease;
      lease = undefined;
      yield* Scope.close(current, Exit.void);
    }
    if (battery) {
      yield* Fiber.interrupt(battery);
      battery = undefined;
    }
    yield* SubscriptionRef.update(state, (s) => ({ ...s, active: false }));
  });
  yield* Effect.addFinalizer(() => stop());
  const end = Effect.fn("KeepAwake.end")(function* (reason: string | null) {
    yield* stop();
    yield* SubscriptionRef.update(state, (s) => ({
      ...s,
      mode: "off" as const,
      endsAt: null,
      reason,
    }));
  });
  const start = Effect.fn("KeepAwake.acquire")(function* () {
    const s = yield* SubscriptionRef.get(state);
    if (lease || !s.supported || s.mode === "off" || (s.mode === "agents" && s.agents === 0))
      return;
    if (s.options.batteryCutoff !== null) {
      const level = yield* inhibitor.battery;
      if (level !== null && level <= s.options.batteryCutoff)
        return yield* end("Stopped at battery cutoff.");
    }
    if (s.options.lidClosed) {
      const enabled = yield* lid.enable.pipe(Effect.result);
      if (enabled._tag === "Failure") {
        yield* SubscriptionRef.update(state, (s) => ({ ...s, reason: enabled.failure.message }));
        return;
      }
    }
    const acquired = yield* Scope.make();
    const result = yield* inhibitor.acquire(s.options).pipe(Scope.provide(acquired), Effect.result);
    if (result._tag === "Failure") {
      yield* lid.restore.pipe(Effect.ignore);
      yield* Scope.close(acquired, Exit.void);
      yield* SubscriptionRef.update(state, (s) => ({
        ...s,
        supported: false,
        reason: "Could not acquire the host sleep inhibitor.",
      }));
      return;
    }
    lease = acquired;
    yield* SubscriptionRef.update(state, (s) => ({ ...s, active: true, reason: null }));
    yield* result.success.pipe(
      Effect.ignore,
      Effect.andThen(
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (lease !== acquired) return;
            yield* end("The host sleep inhibitor exited.");
            yield* SubscriptionRef.update(state, (s) => ({ ...s, supported: false }));
          }),
        ),
      ),
      Effect.forkIn(scope),
    );
    if (s.options.batteryCutoff !== null) {
      battery = yield* Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep("1 minute");
          const level = yield* inhibitor.battery;
          const current = yield* SubscriptionRef.get(state);
          if (
            level !== null &&
            current.options.batteryCutoff !== null &&
            level <= current.options.batteryCutoff
          ) {
            battery = undefined;
            yield* lock.withPermits(1)(end("Stopped at battery cutoff."));
            return;
          }
        }
      }).pipe(Effect.forkIn(scope));
    }
  });
  const change = Effect.fn("KeepAwake.change")(function* (input: KeepAwakeChange) {
    if (input.defaults) {
      const saved = yield* preferences.save(input.defaults).pipe(Effect.result);
      if (saved._tag === "Failure") {
        yield* SubscriptionRef.update(state, (s) => ({
          ...s,
          reason: "Could not save keep-awake defaults.",
        }));
        return yield* SubscriptionRef.get(state);
      }
      yield* SubscriptionRef.update(state, (s) => ({ ...s, defaults: input.defaults! }));
    }
    if (!input.session && !input.options) return yield* SubscriptionRef.get(state);
    if (expiry) {
      yield* Fiber.interrupt(expiry);
      expiry = undefined;
    }
    if (idle) {
      yield* Fiber.interrupt(idle);
      idle = undefined;
    }
    yield* stop();
    const now = yield* Clock.currentTimeMillis;
    yield* SubscriptionRef.update(state, (s) => ({
      ...s,
      mode: input.session?.mode ?? s.mode,
      endsAt: input.session
        ? input.session.mode === "duration"
          ? now + input.session.minutes * 60_000
          : input.session.mode === "until"
            ? input.session.endsAt
            : null
        : s.endsAt,
      options: input.options ?? s.options,
      reason: s.supported ? null : s.reason,
    }));
    const s = yield* SubscriptionRef.get(state);
    if (s.endsAt !== null) {
      if (s.endsAt <= now) yield* end(null);
      else
        expiry = yield* Effect.sleep(s.endsAt - now).pipe(
          Effect.andThen(lock.withPermits(1)(end(null))),
          Effect.forkIn(scope),
        );
    }
    yield* start();
    return yield* SubscriptionRef.get(state);
  }, lock.withPermits(1));
  const agentsChanged = Effect.fn("KeepAwake.agentsChanged")(function* (count: number) {
    if ((yield* SubscriptionRef.get(state)).agents === count) return;
    yield* SubscriptionRef.update(state, (s) => ({ ...s, agents: count }));
    const s = yield* SubscriptionRef.get(state);
    if (s.mode !== "agents") return;
    if (idle) {
      yield* Fiber.interrupt(idle);
      idle = undefined;
    }
    if (count > 0) yield* start();
    else if (s.active)
      idle = yield* Effect.sleep("10 seconds").pipe(
        Effect.andThen(lock.withPermits(1)(stop())),
        Effect.forkIn(scope),
      );
  }, lock.withPermits(1));
  const until = nextUntilTime(defaults.untilTime, yield* Clock.currentTimeMillis);
  const session: KeepAwakeSession =
    defaults.mode === "duration"
      ? { mode: "duration", minutes: defaults.durationMinutes }
      : defaults.mode === "until"
        ? { mode: "until", endsAt: until }
        : { mode: defaults.mode };
  yield* change({ session });
  const authorizeLid = Effect.fn("KeepAwake.authorizeLid")(function* (
    action: "install" | "remove" | "refresh",
  ) {
    const remove = action === "remove";
    if (remove) {
      const current = yield* SubscriptionRef.get(state);
      yield* change({ options: { ...current.options, lidClosed: false } });
    }
    if (action === "refresh") yield* lid.refresh.pipe(Effect.ignore);
    else yield* lid.authorize(remove).pipe(Effect.ignore);
    const status = yield* lid.status;
    yield* SubscriptionRef.update(state, (s) => ({
      ...s,
      lid: status,
      reason: status.authorized && status.error === null ? null : s.reason,
    }));
    if (!remove) yield* lock.withPermits(1)(start());
    return yield* SubscriptionRef.get(state);
  });
  return KeepAwake.of({
    authorizeLid,
    status: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
    change,
    agentsChanged,
  });
});
export const layer = Layer.effect(KeepAwake, make);
