import type { KeepAwakeOptions } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

export class SleepInhibitor extends Context.Service<
  SleepInhibitor,
  {
    readonly supported: boolean;
    readonly lidClosedSupported: boolean;
    readonly acquire: (
      options: KeepAwakeOptions,
    ) => Effect.Effect<
      Effect.Effect<void, PlatformError.PlatformError>,
      PlatformError.PlatformError,
      Scope.Scope
    >;
    readonly battery: Effect.Effect<number | null>;
  }
>()("t3/keepAwake/SleepInhibitor") {}

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const commandOutput = (command: string, args: string[]) =>
    spawner
      .string(ChildProcess.make(command, args, { stdin: "ignore", stderr: "ignore" }))
      .pipe(Effect.timeout("5 seconds"));
  const supported =
    platform === "darwin" ||
    (platform === "linux" &&
      (yield* commandOutput("systemd-inhibit", ["--list"]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )));
  const acquire = Effect.fn("SleepInhibitor.acquire")(function* (options: KeepAwakeOptions) {
    // -w releases macOS assertions even when the server is killed without finalizers.
    const command =
      platform === "darwin"
        ? ChildProcess.make(
            "/usr/bin/caffeinate",
            ["-i", ...(options.allowDisplaySleep ? [] : ["-d"]), "-w", String(process.pid)],
            { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
          )
        : ChildProcess.make(
            "systemd-inhibit",
            [
              options.allowDisplaySleep ? "--what=sleep" : "--what=idle:sleep",
              "--mode=block",
              "--who=T3 Code",
              "--why=Keep awake session",
              process.execPath,
              "-e",
              "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))",
            ],
            { stdin: Stream.never, stdout: "ignore", stderr: "ignore" },
          );
    const child = yield* spawner.spawn(command);
    return child.exitCode.pipe(Effect.asVoid);
  });
  const battery = Effect.gen(function* () {
    if (platform === "darwin") {
      const output = yield* commandOutput("/usr/bin/pmset", ["-g", "batt"]);
      return output.includes("'Battery Power'") ? Number(/(\d+)%;/.exec(output)?.[1] ?? 0) : null;
    }
    if (platform === "linux") {
      const names = yield* fs.readDirectory("/sys/class/power_supply");
      const batteries = yield* Effect.forEach(names, (name) =>
        Effect.gen(function* () {
          const base = `/sys/class/power_supply/${name}`;
          if ((yield* fs.readFileString(`${base}/type`)).trim() !== "Battery") return null;
          if ((yield* fs.readFileString(`${base}/status`)).trim() !== "Discharging") return null;
          return Number((yield* fs.readFileString(`${base}/capacity`)).trim());
        }),
      );
      const values = batteries.filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
      return values.length ? Math.min(...values) : null;
    }
    return null;
  }).pipe(Effect.orElseSucceed(() => null));
  return SleepInhibitor.of({
    supported,
    lidClosedSupported: platform === "darwin",
    acquire,
    battery,
  });
});

export const layer = Layer.effect(SleepInhibitor, make);
