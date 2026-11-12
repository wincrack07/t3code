import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as ServerConfig from "../config.ts";
import * as LidSleep from "./LidSleep.ts";

export const layer = Layer.effect(
  LidSleep.LidSleepHost,
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const username = yield* HostProcess.Username;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const markerPath = path.join(config.stateDir, "keep-awake-lid-recovery");
    const failure = (operation: string) => (cause: unknown) =>
      new LidSleep.LidSleepError({ operation, cause });
    const run = Effect.fn("LidSleepHost.run")(function* (
      file: string,
      args: ReadonlyArray<string>,
    ) {
      const operation =
        file === "/usr/bin/osascript"
          ? "authorize lid-closed sessions"
          : args.includes("-l")
            ? "check authorization"
            : args.includes("-g")
              ? "read the sleep setting"
              : args.at(-1) === "1"
                ? "disable sleep"
                : "restore sleep";
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(file, args, { stdin: "ignore", stderr: "ignore" }),
          );
          const [output, code] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
            { concurrency: "unbounded" },
          );
          if (code !== 0)
            return yield* new LidSleep.LidSleepError({
              operation,
              exitCode: Number(code),
              cause: { exitCode: code },
            });
          return output;
        }),
      ).pipe(
        Effect.timeout("2 minutes"),
        Effect.mapError((cause) =>
          cause._tag === "LidSleepError" ? cause : failure(operation)(cause),
        ),
      );
    });
    return {
      supported: platform === "darwin",
      nativeAuthorization: platform === "darwin" && config.mode === "desktop",
      username: username ?? "",
      run,
      marker: fs.exists(markerPath).pipe(Effect.mapError(failure("read recovery marker"))),
      writeMarker: writeFileStringAtomically({ filePath: markerPath, contents: "0\n" }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(failure("write recovery marker")),
      ),
      clearMarker: fs
        .remove(markerPath, { force: true })
        .pipe(Effect.mapError(failure("clear recovery marker"))),
    };
  }),
);
