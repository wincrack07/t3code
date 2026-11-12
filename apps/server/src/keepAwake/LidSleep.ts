import type { KeepAwakeLidStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as Stream from "effect/Stream";
import { lidAuthorizationScript, shellQuote } from "./lidAuthorization.ts";

export class LidSleepError extends Schema.TaggedError<LidSleepError>()("LidSleepError", {
  operation: Schema.String,
  cause: Schema.Defect(),
  exitCode: Schema.optionalKey(Schema.Number),
}) {
  override get message() {
    return this.operation === "authorization missing"
      ? "Authorize Keep awake to use it with the lid closed."
      : `Could not ${this.operation}${this.exitCode === undefined ? "" : ` (exit ${this.exitCode})`}. Try again or check authorization.`;
  }
}

export class LidSleepHost extends Context.Service<
  LidSleepHost,
  {
    readonly supported: boolean;
    readonly nativeAuthorization: boolean;
    readonly username: string;
    readonly run: (
      file: string,
      args: ReadonlyArray<string>,
    ) => Effect.Effect<string, LidSleepError>;
    readonly marker: Effect.Effect<boolean, LidSleepError>;
    readonly writeMarker: Effect.Effect<void, LidSleepError>;
    readonly clearMarker: Effect.Effect<void, LidSleepError>;
  }
>()("t3/keepAwake/LidSleep/LidSleepHost") {}

export class LidSleep extends Context.Service<
  LidSleep,
  {
    readonly status: Effect.Effect<KeepAwakeLidStatus>;
    readonly changes: Stream.Stream<KeepAwakeLidStatus>;
    readonly enable: Effect.Effect<void, LidSleepError>;
    readonly restore: Effect.Effect<void, LidSleepError>;
    readonly refresh: Effect.Effect<void, LidSleepError>;
    readonly authorize: (remove: boolean) => Effect.Effect<void, LidSleepError>;
  }
>()("t3/keepAwake/LidSleep") {}

const make = Effect.gen(function* () {
  const host = yield* LidSleepHost;
  const lock = yield* Semaphore.make(1);
  const install = host.supported ? lidAuthorizationScript(host.username, false) : "";
  const removal = lidAuthorizationScript(host.username, true);
  const state = yield* SubscriptionRef.make<KeepAwakeLidStatus>({
    authorized: false,
    active: false,
    error: null,
    nativeAuthorization: host.nativeAuthorization,
    installCommand: host.supported ? `/usr/bin/sudo /bin/sh -c ${shellQuote(install)}` : "",
    removeCommand: host.supported ? `/usr/bin/sudo /bin/sh -c ${shellQuote(removal)}` : "",
  });
  const recordError = (error: LidSleepError) =>
    SubscriptionRef.update(state, (s) => ({ ...s, error: error.message }));
  const read = host.run("/usr/bin/pmset", ["-g"]).pipe(
    Effect.flatMap((output) => {
      const value = /\bSleepDisabled\s+([01])\b/.exec(output)?.[1];
      return value === undefined
        ? Effect.fail(
            new LidSleepError({ operation: "read SleepDisabled", cause: "Missing SleepDisabled" }),
          )
        : Effect.succeed(value === "1");
    }),
  );
  const set = (enabled: boolean) =>
    host.run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", enabled ? "1" : "0"]);
  const refresh = Effect.fn("LidSleep.refreshAuthorization")(function* () {
    if (!host.supported) return;
    const listing = yield* host
      .run("/usr/bin/sudo", ["-n", "-l"])
      .pipe(Effect.orElseSucceed(() => ""));
    const grants = listing
      .replace(/\s+/g, " ")
      .split(/(?=\([^)]*\)\s+)/)
      .filter((part) => /^\((?:root|ALL)(?:\s*:\s*ALL)?\)\s*NOPASSWD:/.test(part));
    const authorized = grants.some(
      (part) =>
        part.includes("/usr/bin/pmset -a disablesleep 1") &&
        part.includes("/usr/bin/pmset -a disablesleep 0"),
    );
    const pendingRecovery = yield* host.marker;
    yield* SubscriptionRef.update(state, (s) => ({
      ...s,
      authorized,
      error: authorized && !pendingRecovery ? null : s.error,
    }));
  }, Effect.tapError(recordError));
  const restoreState = Effect.fn("LidSleep.restore")(function* () {
    if (host.supported && (yield* host.marker)) {
      yield* set(false);
      yield* host.clearMarker;
    }
    yield* SubscriptionRef.update(state, (s) => ({ ...s, active: false, error: null }));
  }, Effect.tapError(recordError));
  const restore = lock.withPermits(1)(restoreState());
  const enable = Effect.fn("LidSleep.enable")(
    function* () {
      if (!host.supported) return;
      yield* refresh();
      if (!(yield* SubscriptionRef.get(state)).authorized)
        return yield* new LidSleepError({
          operation: "authorization missing",
          cause: "Authorize lid sleep control first",
        });
      if (!(yield* read)) {
        yield* host.writeMarker;
        yield* set(true);
      }
      yield* SubscriptionRef.update(state, (s) => ({ ...s, active: true, error: null }));
    },
    lock.withPermits(1),
    Effect.tapError(recordError),
  );
  const authorize = Effect.fn("LidSleep.authorize")(
    function* (remove: boolean) {
      if (!host.nativeAuthorization)
        return yield* new LidSleepError({
          operation: "local desktop required",
          cause: "Run the displayed command on the Mac",
        });
      if (remove) yield* restoreState();
      const script = remove ? removal : install;
      const appleScript = `do shell script "${script.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}" with administrator privileges`;
      yield* host.run("/usr/bin/osascript", ["-e", appleScript]);
      yield* refresh();
      if (!(yield* SubscriptionRef.get(state)).active) yield* restoreState();
      yield* SubscriptionRef.update(state, (s) => ({ ...s, error: null }));
    },
    lock.withPermits(1),
    Effect.tapError(recordError),
  );
  // Recover before defaults can start another session; failed recovery keeps its marker.
  yield* restore.pipe(Effect.ignore);
  yield* refresh().pipe(Effect.ignore);
  yield* Effect.addFinalizer(() => restore.pipe(Effect.ignore({ log: true })));
  return LidSleep.of({
    status: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
    enable: enable(),
    restore,
    refresh: refresh(),
    authorize,
  });
});
export const layer = Layer.effect(LidSleep, make);
