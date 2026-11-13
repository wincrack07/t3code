import { stableStringify } from "@t3tools/shared/relaySigning";
import * as SecureRandom from "effect/crypto/SecureRandom";
import {
  CommandId,
  Project,
  AUTO_MODEL,
  MessageId,
  ThreadId,
  TaskBatchError,
  TaskBatchStartInput,
  TaskBatchCancelInput,
  type ProjectId,
  type ProjectTaskBatch,
  type TaskBatchEntry,
} from "@t3tools/contracts";
import {
  savedTaskDraftContent,
  resolveTaskBatchLaunch,
  taskBatchEffectiveConcurrency,
  taskBatchBriefKey,
  taskReviewSnapshot,
} from "@t3tools/shared/savedTasks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProjectService from "./ProjectService.ts";

export class TaskBatchService extends Context.Service<
  TaskBatchService,
  {
    readonly start: (input: TaskBatchStartInput) => Effect.Effect<ProjectTaskBatch, TaskBatchError>;
    readonly cancel: (
      input: TaskBatchCancelInput,
    ) => Effect.Effect<ProjectTaskBatch, TaskBatchError>;
    readonly pump: () => Effect.Effect<void, TaskBatchError>;
  }
>()("t3/project/TaskBatchService") {}
const isUnfinished = (entry: TaskBatchEntry) =>
  ["queued", "starting", "running"].includes(entry.state);
const isBatchStart = Schema.is(TaskBatchStartInput);
const isBatchCancel = Schema.is(TaskBatchCancelInput);
const isBatchError = Schema.is(TaskBatchError);
const sourceProjectKey = (source: TaskBatchEntry["source"]) =>
  JSON.stringify([source.environmentId, source.projectId]);
const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const store = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const lock = yield* Semaphore.make(1);
  const random = yield* SecureRandom.SecureRandom;
  const save = Effect.fn("TaskBatchService.save")(function* (
    projectId: ProjectId,
    batches: ReadonlyArray<ProjectTaskBatch>,
    commandId: CommandId,
  ) {
    return yield* projects.update({ projectId, commandId, taskBatches: batches });
  });
  const linkSource = Effect.fn("TaskBatchService.linkSource")(
    function* (entry: TaskBatchEntry) {
      if (entry.source.environmentId !== environmentId) return;
      yield* projects.update({
        projectId: entry.source.projectId,
        commandId: CommandId.make(`${entry.commandId}:task-link`),
        savedPrompt: {
          kind: "link",
          expectedThreadId: entry.expectedThreadId,
          expectedUserMessageId: entry.expectedUserMessageId,
          id: entry.source.taskId,
          threadId: entry.threadId,
          environmentId,
          userMessageId: entry.userMessageId,
        },
      });
    },
    (effect, entry) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Task batch source link failed", {
            projectId: entry.source.projectId,
            taskId: entry.source.taskId,
            cause,
          }),
        ),
      ),
  );
  const readSource = Effect.fn("TaskBatchService.readSource")(function* (
    source: TaskBatchEntry["source"],
  ) {
    if (source.environmentId === environmentId)
      return {
        project: Option.getOrUndefined(yield* projects.getById(source.projectId)),
        verified: true,
      };
    const result = yield* peers
      .call({
        environmentId: source.environmentId,
        tool: "t3_project_read",
        arguments: { projectId: source.projectId },
        limits: { runtimeMode: "full-access", interactionMode: "default" },
        success: Project,
      })
      .pipe(Effect.timeout("10 seconds"), Effect.result);
    return result._tag === "Success"
      ? { project: result.success, verified: result.success.taskDefaults !== undefined }
      : { project: undefined, verified: false };
  });
  const readSources = Effect.fn("TaskBatchService.readSources")(function* (
    entries: ReadonlyArray<Pick<TaskBatchEntry, "source">>,
  ) {
    const sources = [
      ...new Map(entries.map(({ source }) => [sourceProjectKey(source), source])).values(),
    ];
    return new Map(
      yield* Effect.forEach(
        sources,
        (source) =>
          readSource(source).pipe(
            Effect.map((result) => [sourceProjectKey(source), result] as const),
          ),
        { concurrency: 1 },
      ),
    );
  });
  const start: TaskBatchService["Service"]["start"] = Effect.fn("TaskBatchService.start")(
    function* (input) {
      if (!isBatchStart(input))
        return yield* new TaskBatchError({
          operation: "start",
          reason: "invalid-input",
        });
      const row = Option.getOrUndefined(yield* store.get(input.projectId));
      if (!row || row.deletedAt !== null)
        return yield* new TaskBatchError({
          operation: "start",
          reason: "missing-project",
          projectId: input.projectId,
        });
      const existing = row.taskBatches?.find((batch) => batch.id === input.commandId);
      if (existing) return existing;
      const sourceKey = (source: TaskBatchEntry["source"]) =>
        JSON.stringify([source.environmentId, source.projectId, source.taskId]);
      const keys = input.entries.map((entry) => sourceKey(entry.source));
      if (
        new Set(keys).size !== keys.length ||
        input.entries.some(
          (entry) => entry.source.taskId !== entry.brief.id || entry.brief.deletedAt !== undefined,
        )
      )
        return yield* new TaskBatchError({
          operation: "start",
          reason: "invalid-input",
          projectId: input.projectId,
        });
      if (
        input.entries.some(
          (entry) =>
            entry.source.environmentId !== environmentId &&
            entry.brief.attachments?.some((attachment) => attachment.kind === "stored"),
        )
      )
        return yield* new TaskBatchError({
          operation: "start",
          reason: "home-only-attachments",
          projectId: input.projectId,
        });
      const allRows = yield* store.list({ pendingTaskBatchesOnly: true });
      const pending = allRows
        .flatMap((row) => row.taskBatches ?? [])
        .flatMap((batch) => batch.entries)
        .filter(isUnfinished);
      if (pending.some((entry) => keys.includes(sourceKey(entry.source))))
        return yield* new TaskBatchError({
          operation: "start",
          reason: "invalid-input",
          projectId: input.projectId,
        });
      if (
        pending.length + input.entries.length > 100 ||
        [
          ...pending.map((entry) => entry.brief?.text ?? ""),
          ...input.entries.map((entry) => entry.brief.text),
        ].reduce((n, text) => n + text.length, 0) > 200000
      )
        return yield* new TaskBatchError({
          operation: "start",
          reason: "capacity",
          projectId: input.projectId,
        });
      const sources = yield* readSources(input.entries);
      const failures = input.entries.map((entry) => {
        if (
          entry.destination !== undefined &&
          (entry.destination.environmentId !== environmentId ||
            entry.destination.projectId !== input.projectId)
        )
          return "settings-changed" as const;
        const sourceResult = sources.get(sourceProjectKey(entry.source))!;
        if (!sourceResult.verified) return "source-unverifiable" as const;
        const source = sourceResult.project;
        const task =
          source?.deletedAt === null
            ? source.savedPrompts?.find(
                (task) => task.id === entry.source.taskId && task.deletedAt === undefined,
              )
            : undefined;
        if (!task || !source) return "source-deleted" as const;
        const resolved = resolveTaskBatchLaunch(
          task,
          source.taskDefaults ?? source,
          entry.fallback ?? entry.launch,
          entry.overrides,
        );
        const prepared = resolveTaskBatchLaunch({}, {}, entry.launch);
        if (
          prepared.modelSelection.model === AUTO_MODEL ||
          prepared.modelSelection.routing === "auto"
        )
          return "unresolved-model" as const;
        if (stableStringify(resolved) !== stableStringify(prepared))
          return "settings-changed" as const;
        if (taskBatchBriefKey(task) !== taskBatchBriefKey(entry.brief))
          return "task-changed" as const;
        return undefined;
      });
      const batch: ProjectTaskBatch = {
        id: input.commandId,
        concurrency: input.concurrency ?? 2,
        startSequence:
          Math.max(
            0,
            ...allRows
              .flatMap((row) => row.taskBatches ?? [])
              .map((batch) => batch.startSequence ?? 0),
          ) + 1,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        entries: input.entries.map((entry, index) => {
          const commandId = CommandId.make(`${input.commandId}:task:${index}`);
          return {
            id: String(index),
            title: savedTaskDraftContent(entry.brief).title,
            commandId,
            source: entry.source,
            destination: { environmentId, projectId: input.projectId },
            expectedThreadId: entry.brief.latestThreadId ?? null,
            expectedUserMessageId: entry.brief.latestUserMessageId ?? null,
            brief: {
              id: entry.brief.id,
              text: entry.brief.text,
              title: entry.brief.title,
              createdAt: entry.brief.createdAt,
              completedAt: null,
              attachments: entry.brief.attachments,
              runSettings: entry.brief.runSettings,
              acceptanceCriteria: entry.brief.acceptanceCriteria,
            },
            launch: entry.launch,
            overrides: entry.overrides,
            fallback: entry.fallback,
            threadId: ThreadId.make(`task-batch:${commandId}`),
            userMessageId: MessageId.make(`${commandId}:message`),
            state: failures[index] === undefined ? "queued" : "cancelled",
            ...(failures[index] === undefined
              ? {}
              : {
                  failureReason: failures[index],
                  reason:
                    failures[index] === "source-unverifiable"
                      ? "The destination could not verify the source task. Check its link to the source environment and update both servers."
                      : "The prepared entry could not be validated. Prepare the batch again.",
                }),
          };
        }),
      };
      const active = (row.taskBatches ?? []).filter((item) => item.entries.some(isUnfinished));
      const done = (row.taskBatches ?? []).filter((item) => !item.entries.some(isUnfinished));
      let count = active.reduce((n, item) => n + item.entries.length, batch.entries.length);
      const retained = done
        .filter((item) => {
          count += item.entries.length;
          return count <= 100;
        })
        .slice(0, Math.max(0, 9 - active.length));
      if (
        active.length >= 10 ||
        (count > 100 &&
          active.reduce((n, item) => n + item.entries.length, batch.entries.length) > 100)
      )
        return yield* new TaskBatchError({
          operation: "start",
          reason: "capacity",
          projectId: input.projectId,
        });
      const effectiveConcurrency = taskBatchEffectiveConcurrency([
        ...allRows.flatMap((row) => row.taskBatches ?? []),
        batch,
      ]);
      const stored = yield* save(
        input.projectId,
        [...active, { ...batch, effectiveConcurrency }, ...retained],
        CommandId.make(`${input.commandId}:batch-enqueue`),
      );
      const recorded = stored.taskBatches?.find((item) => item.id === input.commandId);
      if (!recorded)
        return yield* new TaskBatchError({
          operation: "start",
          reason: "missing-batch",
          projectId: input.projectId,
        });
      return recorded;
    },
    (effect, input) =>
      lock.withPermit(effect).pipe(
        Effect.mapError((cause) =>
          isBatchError(cause)
            ? cause
            : new TaskBatchError({
                operation: "start",
                reason: "persistence",
                projectId: input.projectId,
                cause,
              }),
        ),
      ),
  );
  const cancel: TaskBatchService["Service"]["cancel"] = Effect.fn("TaskBatchService.cancel")(
    function* (input) {
      if (!isBatchCancel(input))
        return yield* new TaskBatchError({
          operation: "cancel",
          reason: "invalid-input",
        });
      const row = Option.getOrUndefined(yield* store.get(input.projectId));
      const batch = row?.taskBatches?.find((batch) => batch.id === input.batchId);
      if (
        !batch ||
        (input.entryId !== undefined && !batch.entries.some((entry) => entry.id === input.entryId))
      )
        return yield* new TaskBatchError({
          operation: "cancel",
          reason: "missing-batch",
          projectId: input.projectId,
        });
      const cancelled: ProjectTaskBatch = {
        ...batch,
        entries: batch.entries.map((entry) =>
          (input.entryId === undefined || entry.id === input.entryId) && entry.state === "queued"
            ? { ...entry, state: "cancelled" }
            : entry,
        ),
      };
      yield* save(
        input.projectId,
        row!.taskBatches!.map((item) => (item.id === input.batchId ? cancelled : item)),
        input.commandId,
      );
      return cancelled;
    },
    (effect, input) =>
      lock.withPermit(effect).pipe(
        Effect.mapError((cause) =>
          isBatchError(cause)
            ? cause
            : new TaskBatchError({
                operation: "cancel",
                reason: "persistence",
                projectId: input.projectId,
                cause,
              }),
        ),
      ),
  );
  const pump: TaskBatchService["Service"]["pump"] = Effect.fn("TaskBatchService.pump")(
    function* () {
      let rows = yield* store.list({ pendingTaskBatchesOnly: true });
      const sources = yield* readSources(
        rows
          .flatMap((row) => row.taskBatches ?? [])
          .flatMap((batch) => batch.entries)
          .filter((entry) => entry.state === "queued"),
      );
      for (const row of rows) {
        let changed = false;
        const batches: ProjectTaskBatch[] = [];
        for (const batch of row.taskBatches ?? []) {
          const entries: TaskBatchEntry[] = [];
          for (const entry of batch.entries) {
            // Older queues never confirmed per-task settings, so they must be prepared again.
            if (entry.state === "queued" && entry.destination === undefined) {
              entries.push({
                ...entry,
                brief: undefined,
                state: "cancelled",
                failureReason: "settings-changed",
                reason: "Prepare this older queued task again to confirm its launch settings.",
              });
              changed = true;
              continue;
            }
            if (entry.state === "queued") {
              const sourceResult = sources.get(sourceProjectKey(entry.source))!;
              const source = sourceResult.project;
              if (
                !sourceResult.verified ||
                !source ||
                source.deletedAt !== null ||
                !source.savedPrompts?.some(
                  (task) => task.id === entry.source.taskId && task.deletedAt === undefined,
                )
              ) {
                entries.push({
                  ...entry,
                  brief: undefined,
                  state: "cancelled",
                  failureReason: sourceResult.verified ? "source-deleted" : "source-unverifiable",
                  reason: "The source task could not be verified.",
                });
                changed = true;
                continue;
              }
            }
            if (entry.state !== "running") {
              entries.push(entry);
              continue;
            }
            yield* linkSource(entry);
            const projection = yield* projections.getThreadProjection(entry.threadId).pipe(
              Effect.catchTags({
                ProjectionStoreThreadNotFoundError: () => Effect.succeed(null),
              }),
            );
            if (projection === null) {
              entries.push({
                ...entry,
                state: "failed-to-start",
                reason: "The launched thread is unavailable.",
              });
              changed = true;
              continue;
            }
            const run = projection.runs.find(
              (run) => run.id === entry.runId || run.userMessageId === entry.userMessageId,
            );
            const snapshot = run === undefined ? undefined : taskReviewSnapshot(projection, run.id);
            const ended =
              run !== undefined &&
              ["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(
                run.status,
              );
            if (!ended && snapshot?.outcome !== "waiting for input") {
              entries.push(entry);
              continue;
            }
            entries.push({
              ...entry,
              state: "settled",
              ...(snapshot === undefined ? {} : { snapshot }),
            });
            changed = true;
          }
          batches.push({ ...batch, entries });
        }
        if (changed)
          yield* save(
            row.projectId,
            batches,
            CommandId.make(`task-batch:reconcile:${yield* random.uuidV4()}`),
          );
      }
      for (;;) {
        rows = yield* store.list({ pendingTaskBatchesOnly: true });
        const batches = rows.flatMap((row) =>
          (row.taskBatches ?? []).map((batch) => ({ row, batch })),
        );
        const unfinished = batches.filter(({ batch }) => batch.entries.some(isUnfinished));
        const limit = taskBatchEffectiveConcurrency(unfinished.map(({ batch }) => batch));
        for (const row of rows) {
          if (
            (row.taskBatches ?? []).some(
              (batch) => batch.entries.some(isUnfinished) && batch.effectiveConcurrency !== limit,
            )
          )
            yield* save(
              row.projectId,
              row.taskBatches!.map((batch) => ({ ...batch, effectiveConcurrency: limit })),
              CommandId.make(`task-batch:cap:${yield* random.uuidV4()}`),
            );
        }
        const occupied = unfinished
          .flatMap(({ batch }) => batch.entries)
          .filter((entry) => entry.state === "running" || entry.state === "starting").length;
        const next = unfinished
          .flatMap(({ row, batch }) =>
            batch.entries
              .filter((entry) => entry.state === "starting" || entry.state === "queued")
              .map((entry) => ({ row, batch, entry })),
          )
          .sort((a, b) =>
            a.entry.state === b.entry.state
              ? a.batch.createdAt.localeCompare(b.batch.createdAt)
              : a.entry.state === "starting"
                ? -1
                : 1,
          )[0];
        if (!next || (next.entry.state !== "starting" && occupied >= limit)) return;
        const { row, batch, entry } = next;
        const replace = (value: TaskBatchEntry) =>
          row.taskBatches!.map((item) =>
            item.id !== batch.id
              ? item
              : {
                  ...item,
                  effectiveConcurrency: limit,
                  entries: item.entries.map((candidate) =>
                    candidate.id === entry.id ? value : candidate,
                  ),
                },
          );
        if (entry.state === "queued") {
          const sourceResult = yield* readSource(entry.source);
          const source = sourceResult.project;
          if (
            !sourceResult.verified ||
            !source ||
            source.deletedAt !== null ||
            !source.savedPrompts?.some(
              (task) => task.id === entry.source.taskId && task.deletedAt === undefined,
            )
          ) {
            yield* save(
              row.projectId,
              replace({
                ...entry,
                brief: undefined,
                state: "cancelled",
                failureReason: sourceResult.verified ? "source-deleted" : "source-unverifiable",
                reason: "The source task could not be verified.",
              }),
              CommandId.make(`${entry.commandId}:source-unavailable`),
            );
            continue;
          }
        }
        if (entry.state === "queued")
          yield* save(
            row.projectId,
            replace({ ...entry, state: "starting" }),
            CommandId.make(`${entry.commandId}:claim`),
          );
        if (!entry.brief) {
          yield* save(
            row.projectId,
            replace({
              ...entry,
              state: "failed-to-start",
              reason: "The queued brief is unavailable.",
            }),
            CommandId.make(`${entry.commandId}:missing-brief`),
          );
          continue;
        }
        const draft = savedTaskDraftContent(entry.brief);
        const launch =
          entry.destination === undefined
            ? resolveTaskBatchLaunch(entry.brief, {}, entry.launch, entry.overrides)
            : entry.launch;
        const base = {
          modelSelection: launch.modelSelection,
          runtimeMode: launch.runtimeMode,
          interactionMode: launch.interactionMode,
          workspaceStrategy:
            launch.threadEnvMode === "worktree"
              ? { type: "worktree" as const, baseRef: launch.baseRef ?? "HEAD" }
              : { type: "root" as const },
        };
        const settings = base;
        const result = yield* launches
          .launch({
            createdBy: "user",
            creationSource: "web",
            commandId: entry.commandId,
            threadId: entry.threadId,
            projectId: row.projectId,
            title: draft.title,
            ...settings,
            ...(entry.destination === undefined
              ? { taskOverrides: { modelSelection: settings.modelSelection } }
              : { useProjectDefaultModel: false }),
            initialMessage: { ...draft, messageId: entry.userMessageId },
          })
          .pipe(Effect.result);
        if (result._tag === "Failure") {
          const cause = result.failure;
          const accepted = yield* projections
            .getThreadProjection(entry.threadId)
            .pipe(
              Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
            );
          const run = accepted?.runs.find((run) => run.userMessageId === entry.userMessageId);
          const snapshot =
            accepted === null || run === undefined
              ? undefined
              : taskReviewSnapshot(accepted, run.id);
          yield* save(
            row.projectId,
            replace({
              ...entry,
              brief: undefined,
              state:
                run === undefined
                  ? "failed-to-start"
                  : snapshot === undefined
                    ? "running"
                    : "settled",
              reason:
                cause._tag === "ThreadLaunchError"
                  ? `Launch failed during ${cause.operation}.`
                  : cause.message.slice(0, 1000),
              ...(run === undefined ? {} : { runId: run.id }),
              ...(snapshot === undefined ? {} : { snapshot }),
            }),
            CommandId.make(`${entry.commandId}:launch-result`),
          );
          continue;
        }
        yield* linkSource({ ...entry, threadId: result.success.threadId });
        const run =
          result.success.projection.runs.find((run) => run.userMessageId === entry.userMessageId) ??
          result.success.projection.runs.at(-1);
        const snapshot =
          run === undefined ? undefined : taskReviewSnapshot(result.success.projection, run.id);
        yield* save(
          row.projectId,
          replace({
            ...entry,
            brief: undefined,
            state: snapshot === undefined ? "running" : "settled",
            threadId: result.success.threadId,
            ...(run === undefined ? {} : { runId: run.id, userMessageId: run.userMessageId }),
            ...(snapshot === undefined ? {} : { snapshot }),
          }),
          CommandId.make(`${entry.commandId}:launched`),
        );
      }
    },
    (effect) =>
      lock
        .withPermit(effect)
        .pipe(
          Effect.mapError(
            (cause) => new TaskBatchError({ operation: "pump", reason: "persistence", cause }),
          ),
        ),
  );
  return TaskBatchService.of({ start, cancel, pump });
});
export const layer = Layer.effect(TaskBatchService, make);
