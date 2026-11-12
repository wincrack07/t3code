import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import { ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { RunId } from "@t3tools/contracts";
import { activeMachineCleanupPaths } from "./machineCleanupThreads.ts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as Config from "./config.ts";
import * as Settings from "./serverSettings.ts";
import * as Projections from "./orchestration-v2/ProjectionStore.ts";
import * as Cleanup from "./MachineCleanupService.ts";

it.effect(
  "starts a background job and cancellation aborts its command without deleting files",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "t3-cleanup-job-" }),
        );
        const stateDir = path.join(home, "state");
        yield* fs.makeDirectory(stateDir);
        const started = Promise.withResolvers<void>();
        let aborted = false;
        const command: typeof import("./machineCleanupNode.ts").cleanupNodeCommand = (
          _cwd,
          _command,
          _args,
          signal,
        ) =>
          new Promise((_resolve, reject) => {
            started.resolve();
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        const program = Effect.gen(function* () {
          const service = yield* Cleanup.MachineCleanup;
          yield* service.scan;
          yield* Effect.promise(() => started.promise);
          expect((yield* service.current).running).toBe(true);
          yield* service.cancel;
          expect(aborted).toBe(true);
          expect((yield* service.current).running).toBe(false);
          expect(yield* fs.exists(stateDir)).toBe(true);
        });
        yield* program.pipe(
          Effect.provide(
            Cleanup.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Config.layerTest(home, path.join(home, ".t3")),
                  Layer.mock(Settings.ServerSettingsService)({
                    getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
                  }),
                  Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
                  Layer.mock(Projections.ProjectionStoreV2)({
                    getShellSnapshot: () =>
                      Effect.succeed({
                        schemaVersion: 1,
                        snapshotSequence: 0,
                        threads: [],
                        archivedThreads: [],
                      }),
                  }),
                  Layer.succeed(HostProcess.HomeDirectory, home),
                  Layer.succeed(HostProcess.Platform, "linux"),
                  Layer.succeed(Cleanup.Commands, command),
                ),
              ),
            ),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it("uses T3 records to retain unsettled, running and queued worktrees", () => {
  const now = Date.UTC(2026, 10, 11);
  const settled = {
    projectId: ProjectId.make("fixture"),
    worktreePath: "/fixture/settled",
    settledAt: DateTime.makeUnsafe(0),
    settledOverride: null,
    activeRunId: null,
    pendingBackgroundTasks: [],
    latestUserMessageAt: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestRunId: null,
    status: "idle" as const,
  };
  expect(
    activeMachineCleanupPaths(
      [
        settled,
        { ...settled, worktreePath: null, settledAt: null },
        { ...settled, worktreePath: "/fixture/unsettled", settledAt: null },
        { ...settled, worktreePath: "/fixture/running", activeRunId: RunId.make("fixture-run") },
        {
          ...settled,
          worktreePath: "/fixture/queued",
          latestUserMessageAt: DateTime.makeUnsafe(now),
        },
      ],
      now,
      [{ id: settled.projectId, workspaceRoot: "/fixture/project-root" }],
    ),
  ).toEqual(["/fixture/project-root", "/fixture/unsettled", "/fixture/running", "/fixture/queued"]);
});
