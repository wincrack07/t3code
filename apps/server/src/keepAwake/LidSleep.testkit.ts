import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as LidSleep from "./LidSleep.ts";

export const fixture = Effect.fn("TestLidSleep.fixture")(function* (
  prior = false,
  recovery = false,
  authorized = true,
) {
  const value = yield* Ref.make(prior);
  const marker = yield* Ref.make(recovery);
  const allowed = yield* Ref.make(authorized);
  const failRestore = yield* Ref.make(false);
  const calls = yield* Ref.make<ReadonlyArray<readonly [string, ReadonlyArray<string>]>>([]);
  const run = Effect.fn("TestLidSleep.run")(function* (file: string, args: ReadonlyArray<string>) {
    yield* Ref.update(calls, (all) => [...all, [file, args] as const]);
    // Like macOS, `pmset -g` lists SleepDisabled only while it is on.
    if (file === "/usr/bin/pmset")
      return (yield* Ref.get(value))
        ? "System-wide power settings:\n SleepDisabled\t\t1\nCurrently in use:\n standby 1\n"
        : "Currently in use:\n standby 1\n";
    if (args.includes("-l"))
      return (yield* Ref.get(allowed))
        ? "(root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0"
        : "";
    if (file === "/usr/bin/osascript") {
      yield* Ref.set(allowed, !args[1]?.includes("/bin/rm -f /etc/sudoers.d/t3code-keep-awake"));
      return "";
    }
    if (!(yield* Ref.get(allowed)) || (args.at(-1) === "0" && (yield* Ref.get(failRestore))))
      return yield* new LidSleep.LidSleepError({ operation: "pmset", cause: "denied" });
    if (!(yield* Ref.get(marker))) return yield* Effect.die("Mutation must follow recovery marker");
    yield* Ref.set(value, args.at(-1) === "1");
    return "";
  });
  const host = LidSleep.LidSleepHost.of({
    supported: true,
    nativeAuthorization: true,
    username: "julio",
    run,
    marker: Ref.get(marker),
    writeMarker: Ref.set(marker, true),
    clearMarker: Ref.set(marker, false),
  });
  return { host, value, marker, allowed, calls, failRestore };
});
