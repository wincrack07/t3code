import * as LidSleep from "./LidSleep.ts";
import * as LidSleepHost from "./LidSleepHost.ts";
import { traySamples } from "./traySamples.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SystemMonitor from "../systemMonitor/SystemMonitor.ts";
import { updateRunActivity } from "./activity.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import { DEFAULT_KEEP_AWAKE, DEFAULT_TRAY_STATS, KeepAwakeDefaults } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as KeepAwake from "./KeepAwake.ts";
import * as SleepInhibitor from "./SleepInhibitor.ts";

const encodePreferences = Schema.encodeEffect(Schema.fromJsonString(KeepAwakeDefaults));
const decodePreferences = Schema.decodeUnknownEffect(Schema.fromJsonString(KeepAwakeDefaults));

const preferences = Layer.effect(
  KeepAwake.KeepAwakePreferences,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const file = path.join(config.stateDir, "keep-awake.json");
    const load = fs.readFileString(file).pipe(
      Effect.flatMap(decodePreferences),
      Effect.orElseSucceed(() => DEFAULT_KEEP_AWAKE),
    );
    const save = Effect.fn("KeepAwakePreferences.save")(function* (defaults: KeepAwakeDefaults) {
      const contents = yield* encodePreferences(defaults);
      yield* writeFileStringAtomically({ filePath: file, contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    });
    return { load, save };
  }),
);

export const layer = KeepAwake.layer.pipe(
  Layer.provide(SleepInhibitor.layer),
  Layer.provide(LidSleep.layer.pipe(Layer.provide(LidSleepHost.layer))),
  Layer.provide(preferences),
);

export const activityLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* KeepAwake.KeepAwake;
    const desktop = yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;
    const platform = yield* HostProcess.Platform;
    const monitor = yield* SystemMonitor.SystemMonitor;
    const health = yield* desktop.subscribeHealth;
    yield* Stream.merge(
      service.changes.pipe(Stream.map(() => undefined)),
      Stream.concat(Stream.make(health.latest), health.changes).pipe(Stream.map(() => undefined)),
    ).pipe(
      Stream.mapEffect(() => Effect.all([service.status, desktop.health])),
      Stream.tap(([status]) => desktop.reportKeepAwake(status).pipe(Effect.ignore)),
      Stream.map(
        ([status, connection]) =>
          platform === "darwin" &&
          connection.status === "healthy" &&
          (status.defaults.trayStats ?? DEFAULT_TRAY_STATS).enabled,
      ),
      (enabled) => traySamples(enabled, monitor.stream({ detail: false })),
      Stream.runForEach((frame) =>
        service.status.pipe(
          Effect.flatMap((status) => desktop.reportKeepAwake(status, frame?.sample)),
          Effect.ignore,
        ),
      ),
      Effect.forkScoped,
    );
    yield* desktop.keepAwakeChanges.pipe(
      Stream.runForEach((session) => service.change({ session })),
      Effect.forkScoped,
    );
    const sink = yield* EventSink.EventSinkV2;
    const sql = yield* SqlClient.SqlClient;
    const sequence = yield* sink.latestSequence();
    const rows = yield* sql<{
      run_id: string;
      thread_id: string;
    }>`SELECT run_id, thread_id FROM orchestration_v2_projection_runs WHERE status IN ('preparing', 'queued', 'starting', 'running', 'waiting')`;
    const runs = new Map(rows.map((row) => [row.run_id, row.thread_id]));
    yield* service.agentsChanged(runs.size);
    yield* sink.stream({ afterSequence: sequence }).pipe(
      Stream.runForEach(({ event }) => {
        if (event.type === "thread.deleted")
          return service.agentsChanged(
            updateRunActivity(runs, { type: "thread.deleted", threadId: event.threadId }),
          );
        if (event.type === "run.created" || event.type === "run.updated")
          return service.agentsChanged(
            updateRunActivity(runs, {
              type: event.type,
              threadId: event.threadId,
              payload: event.payload,
            }),
          );
        return Effect.void;
      }),
      Effect.forkScoped,
    );
  }),
);
