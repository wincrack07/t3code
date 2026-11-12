import {
  scanTaskAttachmentCopies,
  deleteTaskAttachmentCopy,
} from "./project/taskAttachmentCleanup.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as DateTime from "effect/DateTime";
import { cleanupScheduleDay, selectedMachineCleanupItems } from "./machineCleanupSchedule.ts";
import { forkParked } from "./serverActivation.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";
import {
  MachineCleanupError,
  MachineCleanupReport,
  type MachineCleanupSelection,
  type MachineCleanupState,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "./config.ts";
import * as Settings from "./serverSettings.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import { activeMachineCleanupPaths } from "./machineCleanupThreads.ts";
import {
  makeMachineCleanupNode,
  cleanupNodeCommand,
  cleanupNodeFreeSpace,
} from "./machineCleanupNode.ts";

export class MachineCleanup extends Context.Service<
  MachineCleanup,
  {
    readonly scan: Effect.Effect<void, MachineCleanupError>;
    readonly runPhaseA: Effect.Effect<void, MachineCleanupError>;
    readonly deleteApproved: (
      selection: MachineCleanupSelection,
    ) => Effect.Effect<void, MachineCleanupError>;
    readonly runPhaseC: (
      selection: MachineCleanupSelection,
    ) => Effect.Effect<void, MachineCleanupError>;
    readonly cancel: Effect.Effect<void>;
    readonly state: Stream.Stream<MachineCleanupState>;
    readonly current: Effect.Effect<MachineCleanupState>;
    readonly history: Effect.Effect<readonly MachineCleanupReport[]>;
  }
>()("t3/MachineCleanupService/MachineCleanup") {}

export class Commands extends Context.Reference<typeof cleanupNodeCommand>(
  "t3/MachineCleanupService/Commands",
  { defaultValue: () => cleanupNodeCommand },
) {}

const encodeHistory = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(MachineCleanupReport)),
);
const isCleanupError = Schema.is(MachineCleanupError);

const make = Effect.gen(function* () {
  const home = yield* HostProcess.HomeDirectory;
  const command = yield* Commands;
  const platform = yield* HostProcess.Platform;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* Settings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const mutex = yield* Semaphore.make(1);
  const historyPath = path.join(config.stateDir, "machine-cleanup-history.json");
  const schedulePath = path.join(config.stateDir, "machine-cleanup-last-day");
  let lastScheduledDay = yield* fs
    .readFileString(schedulePath)
    .pipe(Effect.orElseSucceed(() => ""));
  const decodeHistory = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(MachineCleanupReport)),
  );
  const history = yield* fs.readFileString(historyPath).pipe(
    Effect.flatMap(decodeHistory),
    Effect.orElseSucceed(() => []),
  );
  const ref = yield* SubscriptionRef.make<MachineCleanupState>({
    running: false,
    progress: "",
    report: history[0] ?? null,
    history,
  });
  let activePaths: readonly string[] = [];
  let progress = "";
  let job: Fiber.Fiber<void> | null = null;
  let activeJob = 0;
  const backend = makeMachineCleanupNode({
    home,
    t3Home: config.baseDir,
    platform,
    now: Date.now,
    command,
    freeSpace: cleanupNodeFreeSpace,
    activeWorktrees: async () => activePaths,
  });
  const refreshActive = Effect.fn("MachineCleanup.refreshActive")(function* () {
    const snapshot = yield* projections.getShellSnapshot();
    const now = yield* Clock.currentTimeMillis;
    const paths = activeMachineCleanupPaths(
      [...snapshot.threads, ...snapshot.archivedThreads],
      now,
      yield* projects.listShells(),
    );
    const canonical = yield* Effect.forEach(paths, (target) =>
      fs.realPath(target).pipe(Effect.orElseSucceed(() => target)),
    );
    activePaths = [...new Set([...paths, ...canonical])];
  });
  const io = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new MachineCleanupError({ operation, cause }),
    });
  const taskCopies = Effect.fn("MachineCleanup.taskCopies")(function* (
    options: import("@t3tools/contracts").MachineCleanupSettings,
  ) {
    const rows = yield* projects
      .list({ includeDeleted: true })
      .pipe(
        Effect.mapError(
          (cause) => new MachineCleanupError({ operation: "scan-task-attachments", cause }),
        ),
      );
    return yield* io("scan-task-attachments", () =>
      scanTaskAttachmentCopies(config, rows, options),
    );
  });
  const persist = Effect.fn("MachineCleanup.persist")(function* (report: MachineCleanupReport) {
    const previous = yield* SubscriptionRef.get(ref);
    const known = new Set(
      previous.history.flatMap((entry) => entry.items.map((item) => item.path)),
    );
    const large = report.items.filter(
      (item) => item.bytes > 2 * 1024 ** 3 && !known.has(item.path),
    );
    report = {
      ...report,
      notes: [
        ...report.notes,
        ...large.map(
          (item) =>
            `New large path worth reviewing: ${item.path} (${(item.bytes / 1024 ** 3).toFixed(1)} GiB)`,
        ),
      ],
    };
    const history = [report, ...previous.history].slice(0, 100);
    const encoded = yield* encodeHistory(history).pipe(
      Effect.mapError((cause) => new MachineCleanupError({ operation: "history", cause })),
    );
    yield* fs.writeFileString(`${historyPath}.tmp`, encoded).pipe(
      Effect.andThen(fs.rename(`${historyPath}.tmp`, historyPath)),
      Effect.mapError((cause) => new MachineCleanupError({ operation: "history", cause })),
    );
    yield* SubscriptionRef.set(ref, {
      running: false,
      progress: "Finished",
      report,
      history,
      freeNow: report.freeAfter,
      measuredAt: report.finishedAt ?? report.startedAt,
    });
  });
  const start = Effect.fn("MachineCleanup.start")(function* (
    mode: MachineCleanupReport["mode"],
    selection?: MachineCleanupSelection,
  ) {
    yield* mutex.withPermit(
      Effect.gen(function* () {
        if (platform !== "linux" && platform !== "darwin")
          return yield* new MachineCleanupError({
            operation: "unsupported-platform",
            cause: platform,
          });
        const state = yield* SubscriptionRef.get(ref);
        if (state.running)
          return yield* new MachineCleanupError({
            operation: "start",
            cause: "A cleanup job is already running",
          });
        if (
          selection &&
          (state.report?.id !== selection.reportId ||
            selection.itemIds.length === 0 ||
            selection.itemIds.some(
              (id) =>
                !state.report?.items.some(
                  (item) =>
                    item.id === id &&
                    item.phase === (mode === "phaseB" ? "B" : "C") &&
                    item.outcome === "pending",
                ),
            ))
        ) {
          return yield* new MachineCleanupError({
            operation: "selection",
            cause: "Selection is stale or invalid",
          });
        }
        if (mode === "phaseC" && selection?.itemIds.length !== 1)
          return yield* new MachineCleanupError({
            operation: "selection",
            cause: "Approve each aggressive item separately",
          });
        const ticket = ++activeJob;
        const approved = state.report;
        yield* SubscriptionRef.update(ref, (value) => ({
          ...value,
          running: true,
          progress: "Starting",
        }));
        const work = Effect.gen(function* () {
          const currentSettings = (yield* settings.getSettings).machineCleanup;
          yield* refreshActive();
          let report = yield* io("scan", (signal) =>
            backend.scan(currentSettings, signal, (value) => {
              progress = value;
            }),
          );
          const copies = yield* taskCopies(currentSettings);
          report = {
            ...report,
            mode,
            items: [...report.items, ...copies.items],
            taskAttachments: copies.usage,
          };
          if (mode !== "scan") {
            const selected = selectedMachineCleanupItems(report, mode, selection?.itemIds ?? []);
            const missing =
              selection?.itemIds.filter((id) => !selected.some((item) => item.id === id)) ?? [];
            if (missing.length)
              report = {
                ...report,
                notes: [
                  ...report.notes,
                  `${missing.length} approved candidates are no longer eligible and were retained`,
                ],
              };
            for (const item of selected) {
              yield* refreshActive();
              const previous = approved?.items.find((candidate) => candidate.id === item.id);
              if (item.phase === "B" && previous?.head !== item.head) {
                report = {
                  ...report,
                  items: report.items.map((row) =>
                    row.id === item.id
                      ? { ...row, outcome: "skipped", reason: "HEAD changed since approval" }
                      : row,
                  ),
                };
                continue;
              }
              const latestSettings = (yield* settings.getSettings).machineCleanup;
              const result = yield* withWorkspaceLease(
                item.path,
                Effect.gen(function* () {
                  yield* refreshActive();
                  if (item.id.startsWith("task-attachment:"))
                    return yield* withWorkspaceLease(
                      config.attachmentsDir,
                      Effect.gen(function* () {
                        const rows = yield* projects.list({ includeDeleted: true }).pipe(
                          Effect.mapError(
                            (cause) =>
                              new MachineCleanupError({
                                operation: "task-attachment-ownership",
                                cause,
                              }),
                          ),
                        );
                        const removed = yield* io("delete-task-attachment", () =>
                          deleteTaskAttachmentCopy(config, rows, latestSettings, item),
                        );
                        const freeAfter = yield* io("measure", () =>
                          cleanupNodeFreeSpace(report.measurementPath),
                        );
                        return {
                          ...report,
                          items: [removed],
                          freeAfter,
                          measurements: [
                            ...(report.measurements ?? []),
                            {
                              phase: item.phase,
                              itemId: item.id,
                              before: report.freeAfter,
                              after: freeAfter,
                            },
                          ],
                        };
                      }),
                    );
                  return yield* io("delete", (signal) =>
                    backend.execute(
                      { ...report, items: [item] },
                      latestSettings,
                      [item.phase],
                      selection?.itemIds ?? [],
                      signal,
                      (value) => {
                        progress = value;
                      },
                    ),
                  );
                }),
              );
              report = {
                ...result,
                items: report.items.map((row) => (row.id === item.id ? result.items[0]! : row)),
              };
            }
          }
          report = { ...report, taskAttachments: (yield* taskCopies(currentSettings)).usage };
          report = yield* io("notification", (signal) =>
            backend.notify(report, currentSettings, signal),
          );
          yield* persist(report);
        }).pipe(
          Effect.catch((cause) =>
            SubscriptionRef.update(ref, (state) => ({
              ...state,
              running: false,
              progress: isCleanupError(cause)
                ? cause.message
                : "Cleanup failed; remaining files retained",
            })),
          ),
          Effect.ensuring(
            SubscriptionRef.update(ref, (state) =>
              state.running && ticket === activeJob
                ? { ...state, running: false, progress: "Cancelled; remaining files retained" }
                : state,
            ),
          ),
        );
        job = yield* work.pipe(Effect.forkIn(scope));
      }),
    );
  });
  yield* SubscriptionRef.get(ref).pipe(
    Effect.flatMap((state) =>
      state.running && state.progress !== progress
        ? SubscriptionRef.update(ref, (value) => ({ ...value, progress }))
        : Effect.void,
    ),
    Effect.repeat(Schedule.spaced("1 second")),
    Effect.forkIn(scope),
  );
  const scheduledTick = Effect.fn("MachineCleanup.scheduledTick")(
    function* () {
      const state = yield* SubscriptionRef.get(ref);
      if (state.running) return;
      const current = (yield* settings.getSettings).machineCleanup;
      const local = yield* DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);
      const day = cleanupScheduleDay(current, DateTime.toParts(local), lastScheduledDay);
      if (day === null) return;
      yield* start("unattended");
      lastScheduledDay = day;
      yield* fs.writeFileString(`${schedulePath}.tmp`, day);
      yield* fs.rename(`${schedulePath}.tmp`, schedulePath);
    },
    Effect.catch((cause) => Effect.logWarning("Machine cleanup schedule failed", { cause })),
  );
  yield* forkParked(
    scheduledTick().pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid),
  );
  const cancel = Effect.gen(function* () {
    if (job) yield* Fiber.interrupt(job);
  });
  const current = Effect.gen(function* () {
    const free = yield* io("measure", () =>
      cleanupNodeFreeSpace(platform === "darwin" ? "/System/Volumes/Data" : home),
    ).pipe(Effect.orElseSucceed(() => null));
    if (free !== null) {
      const measuredAt = DateTime.formatIso(yield* DateTime.now);
      yield* SubscriptionRef.update(ref, (state) => ({ ...state, freeNow: free, measuredAt }));
    }
    return yield* SubscriptionRef.get(ref);
  });
  return MachineCleanup.of({
    scan: start("scan"),
    runPhaseA: start("phaseA"),
    deleteApproved: Effect.fn("MachineCleanup.deleteApproved")((selection) =>
      start("phaseB", selection),
    ),
    runPhaseC: Effect.fn("MachineCleanup.runPhaseC")((selection) => start("phaseC", selection)),
    cancel,
    state: Stream.fromEffect(current).pipe(
      Stream.concat(SubscriptionRef.changes(ref)),
      Stream.map((state) =>
        state.running
          ? { ...state, report: null, history: [] }
          : {
              ...state,
              history: state.history.map((report) => ({ ...report, items: [], notes: [] })),
            },
      ),
    ),
    current,
    history: SubscriptionRef.get(ref).pipe(Effect.map((state) => state.history)),
  });
});
export const layer = Layer.effect(MachineCleanup, make);
