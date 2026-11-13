import { scopedProjectKey } from "../environment/scoped.ts";
import * as DateTime from "effect/DateTime";
import { chooseLoadBalancedEnvironment } from "../load-balancing.ts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { startThreadTurn, type StartThreadTurnInput } from "../operations/commands.ts";
import {
  savedTaskDraftContent,
  resolveTaskBatchLaunch,
  taskBatchEffectiveConcurrency,
  taskChildCounts,
  savedTaskLaunchSettings,
  taskReviewSnapshot,
} from "@t3tools/shared/savedTasks";
import {
  CommandId,
  AUTO_MODEL,
  type TaskBatchStartInput,
  type TaskRunSettings,
  type SavedPromptAction,
  MessageId,
  type OrchestrationV2ThreadProjection,
  TaskAttachmentsHomeOnlyError,
  type EnvironmentId,
  repositoryGroupingKeyOf,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  type OrchestrationV2ThreadLaunchInput,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request, requestGuarded } from "../rpc/client.ts";
import type { EnvironmentProject } from "./models.ts";
import { createCommandPermissions } from "./commandPermissions.ts";
import {
  createEnvironmentRpcCommand,
  createRuntimeCommand,
  runInEnvironment,
  withCommandPermissions,
} from "./runtime.ts";

export const SavedTaskSource = Schema.Struct({ home: ScopedProjectRef, taskId: Schema.String });
export type SavedTaskSource = typeof SavedTaskSource.Type;
export const SavedTaskLinkReceipt = Schema.Struct({
  ...SavedTaskSource.fields,
  commandId: CommandId,
  thread: ScopedThreadRef,
  expectedThreadId: Schema.optional(Schema.NullOr(ScopedThreadRef.fields.threadId)),
  expectedUserMessageId: Schema.optional(Schema.NullOr(MessageId)),
  userMessageId: Schema.optional(MessageId),
});
export type SavedTaskLinkReceipt = typeof SavedTaskLinkReceipt.Type;
export const SavedTaskDraftBinding = Schema.Struct({
  ...SavedTaskSource.fields,
  receipt: Schema.optional(SavedTaskLinkReceipt),
  linked: Schema.optional(Schema.Boolean),
});
export type SavedTaskDraftBinding = typeof SavedTaskDraftBinding.Type;
export interface SavedTaskDraftBindings {
  readonly get: (thread: ScopedThreadRef) => SavedTaskDraftBinding | undefined;
  readonly set: (thread: ScopedThreadRef, binding: SavedTaskDraftBinding) => void;
}

export class SavedTaskLaunchError extends Schema.TaggedError<SavedTaskLaunchError>()(
  "SavedTaskLaunchError",
  { detail: Schema.String },
) {}

export function createSavedTaskCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | SecureRandom.SecureRandom | R, E>,
  projectAtom: (ref: ScopedProjectRef) => Atom.Atom<EnvironmentProject | null>,
) {
  const permissions = createCommandPermissions(runtime, WS_METHODS.projectsMutate);
  const draftFor = Effect.fn("SavedTaskCommands.prepareDraft")(function* (
    input: {
      source: SavedTaskSource;
      target?: ScopedProjectRef;
      targets?: ReadonlyArray<ScopedProjectRef>;
    },
    registry: AtomRegistry.AtomRegistry,
  ) {
    const home = registry.get(projectAtom(input.source.home));
    // Autosave can commit before the project stream delivers the updated prompt.
    const snapshot = yield* runInEnvironment(
      input.source.home.environmentId,
      requestGuarded(WS_METHODS.projectsTaskAttachments, {
        projectId: input.source.home.projectId,
        taskId: input.source.taskId,
        includePrompt: true,
      }),
    );
    const task = snapshot.task;
    if (!task)
      return yield* new SavedTaskLaunchError({ detail: "The source task is unavailable." });
    const preferred = task.runSettings?.targetEnvironmentId;
    const targetRef =
      input.target ??
      (preferred === undefined || preferred === input.source.home.environmentId
        ? input.source.home
        : input.targets?.find((ref) => ref.environmentId === preferred));
    if (!targetRef)
      return yield* new SavedTaskLaunchError({
        detail: "Load a project on the task's preferred environment, or choose an override.",
      });
    const target = registry.get(projectAtom(targetRef));
    if (!home || !target)
      return yield* new SavedTaskLaunchError({
        detail: "Load the source task and destination project before starting.",
      });
    const sameProject = home.environmentId === target.environmentId && home.id === target.id;
    if (
      !sameProject &&
      (!home.repositoryIdentity ||
        !target.repositoryIdentity ||
        repositoryGroupingKeyOf(home.repositoryIdentity) !==
          repositoryGroupingKeyOf(target.repositoryIdentity))
    )
      return yield* new SavedTaskLaunchError({
        detail: "The destination must belong to the same repository.",
      });
    if (
      input.source.home.environmentId !== targetRef.environmentId &&
      (task.attachments ?? []).some((item) => item.kind === "stored")
    )
      return yield* new TaskAttachmentsHomeOnlyError({
        homeEnvironmentId: input.source.home.environmentId,
      });
    return {
      ...savedTaskDraftContent(task),
      target: targetRef,
      runSettings: task.runSettings,
      projectDefaults: snapshot.projectDefaults,
      task,
    };
  });
  const prepareDraft = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:prepare-draft",
    execute: (
      input: {
        source: SavedTaskSource;
        target?: ScopedProjectRef;
        targets?: ReadonlyArray<ScopedProjectRef>;
      },
      registry,
    ) => draftFor(input, registry).pipe(withCommandPermissions(runtime, registry)),
  });
  const attachments = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:attachments",
    execute: Effect.fn("SavedTaskCommands.attachments")(
      function* (
        input: { source: SavedTaskSource; checkEnvironmentIds?: ReadonlyArray<EnvironmentId> },
        _registry: AtomRegistry.AtomRegistry,
      ) {
        const result = yield* runInEnvironment(
          input.source.home.environmentId,
          requestGuarded(WS_METHODS.projectsTaskAttachments, {
            projectId: input.source.home.projectId,
            taskId: input.source.taskId,
          }),
        );
        const items = result.attachments;
        const paths = items.filter((item) => item.attachment.kind === "reference");
        const states = yield* Effect.forEach(
          [...new Set([input.source.home.environmentId, ...(input.checkEnvironmentIds ?? [])])],
          (environmentId) =>
            Effect.gen(function* () {
              if (paths.length === 0) return { environmentId, entries: [] };
              const metadata = yield* runInEnvironment(
                environmentId,
                request(WS_METHODS.filesystemGetMetadata, { paths: paths.map((item) => item.key) }),
              ).pipe(Effect.option);
              return {
                environmentId,
                entries: paths.map((item, index) => ({
                  key: item.key,
                  state: Option.isNone(metadata)
                    ? ("unavailable" as const)
                    : metadata.value.entries[index] === null
                      ? ("missing" as const)
                      : ("ok" as const),
                  sizeBytes: Option.isSome(metadata)
                    ? (metadata.value.entries[index]?.byteLength ?? null)
                    : null,
                  isDirectory:
                    Option.isSome(metadata) && metadata.value.entries[index]?.kind === "directory",
                })),
              };
            }),
          { concurrency: 1 },
        );
        return items.map((item) => ({
          ...item,
          homeEnvironmentId: input.source.home.environmentId,
          referenceStates: states.flatMap((state) =>
            state.entries
              .filter((entry) => entry.key === item.key)
              .map((entry) => ({ ...entry, environmentId: state.environmentId })),
          ),
        }));
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });
  const retryLinkEffect = Effect.fn("SavedTaskCommands.link")(function* (
    receipt: SavedTaskLinkReceipt,
  ) {
    yield* requestGuarded(WS_METHODS.projectsMutate, {
      type: "project.update",
      commandId: CommandId.make(`${receipt.commandId}:task-link`),
      projectId: receipt.home.projectId,
      savedPrompt: {
        kind: "link",
        expectedThreadId: receipt.expectedThreadId,
        expectedUserMessageId: receipt.expectedUserMessageId,
        ...(receipt.userMessageId === undefined ? {} : { userMessageId: receipt.userMessageId }),
        id: receipt.taskId,
        threadId: receipt.thread.threadId,
        environmentId: receipt.thread.environmentId,
      },
    });
    return { status: "linked" as const, receipt };
  });
  const retryLink = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:link",
    execute: (receipt: SavedTaskLinkReceipt, registry) =>
      runInEnvironment(receipt.home.environmentId, retryLinkEffect(receipt)).pipe(
        withCommandPermissions(runtime, registry),
      ),
  });
  const launch = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:launch",
    execute: Effect.fn("SavedTaskCommands.launch")(
      function* (
        input: {
          source: SavedTaskSource;
          target?: ScopedProjectRef;
          targets?: ReadonlyArray<ScopedProjectRef>;
          overrides?: OrchestrationV2ThreadLaunchInput["taskOverrides"];
          launch: OrchestrationV2ThreadLaunchInput;
        },
        registry: AtomRegistry.AtomRegistry,
      ) {
        const draft = yield* draftFor(input, registry);
        yield* permissions.authorize(registry, input.source.home.environmentId);
        yield* permissions.authorize(registry, draft.target.environmentId);
        const { savedPromptId: _savedPromptId, ...launchInput } = input.launch;
        const overrides = input.overrides ?? launchInput.taskOverrides;
        const settings = savedTaskLaunchSettings(
          { runSettings: draft.runSettings },
          launchInput,
          overrides,
        );
        const result = yield* runInEnvironment(
          draft.target.environmentId,
          request(ORCHESTRATION_V2_WS_METHODS.launchThread, {
            ...launchInput,
            ...settings,
            taskOverrides: { ...overrides, modelSelection: settings.modelSelection },
            title: draft.title,
            initialMessage: { text: draft.text, attachments: draft.attachments },
            projectId: draft.target.projectId,
            useProjectDefaultModel:
              draft.runSettings?.defaultModelSelection === undefined &&
              overrides?.modelSelection === undefined,
          }),
        );
        const receipt: SavedTaskLinkReceipt = {
          ...input.source,
          commandId: input.launch.commandId,
          expectedThreadId: draft.task.latestThreadId ?? null,
          expectedUserMessageId: draft.task.latestUserMessageId ?? null,
          ...(result.projection?.runs.at(-1) === undefined
            ? {}
            : { userMessageId: result.projection.runs.at(-1)!.userMessageId }),
          thread: { environmentId: draft.target.environmentId, threadId: result.threadId },
        };
        return yield* runInEnvironment(receipt.home.environmentId, retryLinkEffect(receipt)).pipe(
          Effect.orElseSucceed(() => ({ status: "started-not-linked" as const, receipt })),
        );
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });
  const reconcileReview = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:reconcile-review",
    execute: (
      input: {
        source: SavedTaskSource;
        thread: ScopedThreadRef;
        projection: OrchestrationV2ThreadProjection;
      },
      registry,
    ) => {
      const run = input.projection.runs.at(-1);
      const snapshot = run === undefined ? undefined : taskReviewSnapshot(input.projection, run.id);
      if (input.projection.thread.id !== input.thread.threadId || snapshot === undefined)
        return Effect.void;
      return runInEnvironment(
        input.source.home.environmentId,
        requestGuarded(WS_METHODS.projectsMutate, {
          type: "project.update",
          projectId: input.source.home.projectId,
          commandId: CommandId.make(
            `task-review:${input.source.home.projectId}:${input.source.taskId}:${snapshot.runId}:${snapshot.outcome}:${snapshot.changes === undefined ? "result" : "checkpoint"}`,
          ),
          savedPrompt: {
            kind: "review",
            id: input.source.taskId,
            threadId: input.thread.threadId,
            environmentId: input.thread.environmentId,
            snapshot,
          },
        }),
      ).pipe(withCommandPermissions(runtime, registry), Effect.asVoid);
    },
  });
  const requestChanges = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:request-changes",
    execute: Effect.fn("SavedTaskCommands.requestChanges")(
      function* (
        input: {
          source: SavedTaskSource;
          thread: ScopedThreadRef;
          commandId: CommandId;
          note: string;
          turn: Pick<StartThreadTurnInput, "runtimeMode" | "interactionMode" | "modelSelection">;
        },
        registry: AtomRegistry.AtomRegistry,
      ) {
        if (input.note.trim().length === 0 || input.note.length > 120000)
          return yield* new SavedTaskLaunchError({
            detail: "Enter a follow-up note of at most 120000 characters.",
          });
        yield* permissions.authorize(registry, input.thread.environmentId);
        const messageId = MessageId.make(`${input.commandId}:task-followup`);
        yield* runInEnvironment(
          input.source.home.environmentId,
          requestGuarded(WS_METHODS.projectsMutate, {
            type: "project.update",
            projectId: input.source.home.projectId,
            commandId: CommandId.make(`${input.commandId}:request-changes`),
            savedPrompt: {
              kind: "request-changes",
              id: input.source.taskId,
              threadId: input.thread.threadId,
              environmentId: input.thread.environmentId,
              userMessageId: messageId,
            },
          }),
        );
        return yield* runInEnvironment(
          input.thread.environmentId,
          startThreadTurn({
            ...input.turn,
            commandId: input.commandId,
            threadId: input.thread.threadId,
            message: { messageId, role: "user", text: input.note, attachments: [] },
            dispatchMode: "start",
          }),
        );
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });
  const quickCreate = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:quick-create",
    execute: (
      input: {
        home: ScopedProjectRef;
        commandId: CommandId;
        text: string;
        position?: "start" | "end";
      },
      registry,
    ) =>
      runInEnvironment(
        input.home.environmentId,
        requestGuarded(WS_METHODS.projectsMutate, {
          type: "project.update",
          projectId: input.home.projectId,
          commandId: input.commandId,
          savedPrompt: {
            kind: "add",
            id: String(input.commandId),
            text: input.text,
            position: input.position,
          },
        }),
      ).pipe(withCommandPermissions(runtime, registry)),
  });
  const addMany = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:add-many",
    execute: (
      input: {
        home: ScopedProjectRef;
        commandId: CommandId;
        tasks: Extract<SavedPromptAction, { kind: "add-many" }>["tasks"];
        position?: "start" | "end";
      },
      registry,
    ) =>
      runInEnvironment(
        input.home.environmentId,
        requestGuarded(WS_METHODS.projectsMutate, {
          type: "project.update",
          projectId: input.home.projectId,
          commandId: input.commandId,
          savedPrompt: { kind: "add-many", tasks: input.tasks, position: input.position },
        }),
      ).pipe(withCommandPermissions(runtime, registry)),
  });
  const batchStart = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:tasks:batch-start",
    tag: WS_METHODS.projectsTaskBatchStart,
  });
  const batchCancel = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:tasks:batch-cancel",
    tag: WS_METHODS.projectsTaskBatchCancel,
  });
  const prepareBatch = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:prepare-batch",
    execute: Effect.fn("SavedTaskCommands.prepareBatch")(
      function* (
        input: {
          commandId: CommandId;
          sources: ReadonlyArray<SavedTaskSource>;
          targets: ReadonlyArray<ScopedProjectRef>;
          target?: ScopedProjectRef;
          distribute?: boolean;
          concurrency?: number;
          weights?: Readonly<Record<string, number>>;
          launch: TaskBatchStartInput["entries"][number]["launch"];
          overrides?: TaskRunSettings;
        },
        registry: AtomRegistry.AtomRegistry,
      ) {
        if (
          (input.concurrency !== undefined &&
            (!Number.isInteger(input.concurrency) ||
              input.concurrency < 1 ||
              input.concurrency > 4)) ||
          input.sources.length === 0 ||
          input.sources.length > 100 ||
          new Set(
            input.sources.map((source) =>
              JSON.stringify([source.home.environmentId, source.home.projectId, source.taskId]),
            ),
          ).size !== input.sources.length
        )
          return yield* new SavedTaskLaunchError({
            detail: "Select between 1 and 100 unique tasks.",
          });
        const resources = input.distribute
          ? yield* Effect.forEach(
              [...new Set(input.targets.map((ref) => ref.environmentId))],
              (environmentId) =>
                Effect.gen(function* () {
                  const value = yield* runInEnvironment(
                    environmentId,
                    request(WS_METHODS.serverGetHostResources, {}),
                  ).pipe(Effect.timeout("5 seconds"), Effect.option);
                  return {
                    environmentId,
                    resources: Option.getOrNull(value),
                    receivedAt: DateTime.toEpochMillis(yield* DateTime.now),
                  };
                }),
              { concurrency: 1 },
            )
          : [];
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const counts = new Map<EnvironmentId, number>();
        for (const ref of input.targets)
          counts.set(
            ref.environmentId,
            (counts.get(ref.environmentId) ?? 0) +
              (registry.get(projectAtom(ref))?.taskBatches ?? [])
                .flatMap((batch) => batch.entries)
                .filter((entry) => entry.state === "running" || entry.state === "starting").length,
          );
        const groups = new Map<
          string,
          {
            environmentId: EnvironmentId;
            currentEffectiveConcurrency: number | null;
            effectiveConcurrency: number;
            input: TaskBatchStartInput;
            /** Tasks that resolved to Auto routing; the batch would refuse them, so they stay out. */
            unresolved: Array<
              TaskBatchStartInput["entries"][number] & {
                failureReason: "unresolved-model";
                reason: string;
              }
            >;
          }
        >();
        for (const source of input.sources) {
          const draft = yield* draftFor({ source, target: source.home }, registry);
          const home = registry.get(projectAtom(source.home));
          const eligible = input.targets.filter((ref) => {
            const project = registry.get(projectAtom(ref));
            return (
              project !== null &&
              home !== null &&
              ((ref.environmentId === source.home.environmentId &&
                ref.projectId === source.home.projectId) ||
                (home.repositoryIdentity != null &&
                  project.repositoryIdentity != null &&
                  repositoryGroupingKeyOf(home.repositoryIdentity) ===
                    repositoryGroupingKeyOf(project.repositoryIdentity))) &&
              (input.weights?.[ref.environmentId] ?? 50) > 0
            );
          });
          const homeOnly = draft.task.attachments?.some((item) => item.kind === "stored");
          const preferred =
            input.overrides?.targetEnvironmentId ?? draft.runSettings?.targetEnvironmentId;
          let target = homeOnly
            ? source.home
            : (input.target ??
              (preferred === undefined
                ? undefined
                : preferred === source.home.environmentId
                  ? source.home
                  : eligible.find((ref) => ref.environmentId === preferred)));
          if (!target && preferred !== undefined)
            return yield* new SavedTaskLaunchError({
              detail: "The task's preferred environment is unavailable.",
            });
          if (!target && input.distribute) {
            const environmentId = chooseLoadBalancedEnvironment(
              eligible.map((ref) => ({
                environmentId: ref.environmentId,
                resources:
                  resources.find((item) => item.environmentId === ref.environmentId)?.resources ??
                  null,
                receivedAt:
                  resources.find((item) => item.environmentId === ref.environmentId)?.receivedAt ??
                  now,
                weight:
                  (input.weights?.[ref.environmentId] ?? 50) /
                  (1 + (counts.get(ref.environmentId) ?? 0)),
              })),
              now,
            );
            target = eligible.find((ref) => ref.environmentId === environmentId);
            if (!target)
              target = eligible
                .filter(
                  (ref) =>
                    resources.find((item) => item.environmentId === ref.environmentId)?.resources ==
                    null,
                )
                .sort(
                  (a, b) => (counts.get(a.environmentId) ?? 0) - (counts.get(b.environmentId) ?? 0),
                )[0];
            if (!target)
              return yield* new SavedTaskLaunchError({
                detail: "Auto balance has no available destination. Choose an environment.",
              });
          }
          target ??= source.home;
          const destination = registry.get(projectAtom(target));
          if (
            !destination ||
            !home ||
            (!(
              target.environmentId === source.home.environmentId &&
              target.projectId === source.home.projectId
            ) &&
              (!home.repositoryIdentity ||
                !destination.repositoryIdentity ||
                repositoryGroupingKeyOf(home.repositoryIdentity) !==
                  repositoryGroupingKeyOf(destination.repositoryIdentity)))
          )
            return yield* new SavedTaskLaunchError({
              detail: "The destination must be a loaded project in the same repository.",
            });
          yield* permissions.authorize(registry, source.home.environmentId);
          yield* createCommandPermissions(runtime, WS_METHODS.projectsTaskBatchStart).authorize(
            registry,
            target.environmentId,
          );
          counts.set(target.environmentId, (counts.get(target.environmentId) ?? 0) + 1);
          const key = scopedProjectKey(target);
          const previous = groups.get(key);
          const entry: TaskBatchStartInput["entries"][number] = {
            source: { ...source.home, taskId: source.taskId },
            brief: draft.task,
            destination: target,
            launch: resolveTaskBatchLaunch(
              draft.task,
              draft.projectDefaults ?? home,
              input.launch,
              input.overrides,
            ),
            fallback: input.launch,
            ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
          };
          const unresolved =
            entry.launch.modelSelection.model === AUTO_MODEL ||
            entry.launch.modelSelection.routing === "auto";
          groups.set(key, {
            environmentId: target.environmentId,
            currentEffectiveConcurrency:
              input.targets
                .filter((ref) => ref.environmentId === target.environmentId)
                .flatMap((ref) => registry.get(projectAtom(ref))?.taskBatches ?? [])
                .find(
                  (batch) =>
                    batch.entries.some((entry) =>
                      ["queued", "starting", "running"].includes(entry.state),
                    ) && batch.effectiveConcurrency !== undefined,
                )?.effectiveConcurrency ?? null,
            effectiveConcurrency: input.concurrency ?? 2,
            input: {
              commandId:
                previous?.input.commandId ??
                CommandId.make(
                  `${input.commandId}:batch:${target.environmentId}:${target.projectId}`,
                ),
              projectId: target.projectId,
              ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
              entries: [...(previous?.input.entries ?? []), ...(unresolved ? [] : [entry])],
            },
            unresolved: [
              ...(previous?.unresolved ?? []),
              ...(unresolved
                ? [
                    {
                      ...entry,
                      failureReason: "unresolved-model" as const,
                      reason: "Auto routing picks a model at start, so it cannot be confirmed now.",
                    },
                  ]
                : []),
            ],
          });
        }
        return [...groups.values()];
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });
  const batchQueueAtom = Atom.family(
    (input: { source: SavedTaskSource; targets: ReadonlyArray<ScopedProjectRef> }) =>
      Atom.make((get) => {
        const entries = input.targets
          .flatMap((target) =>
            (get(projectAtom(target))?.taskBatches ?? []).flatMap((batch) =>
              batch.entries.map((entry) => ({
                target,
                batchId: batch.id,
                effectiveConcurrency: batch.effectiveConcurrency,
                createdAt: batch.createdAt,
                entry,
              })),
            ),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return entries
          .filter(
            ({ entry }) =>
              entry.source.environmentId === input.source.home.environmentId &&
              entry.source.projectId === input.source.home.projectId &&
              entry.source.taskId === input.source.taskId,
          )
          .map((value) => ({
            ...value,
            effectiveConcurrency:
              value.effectiveConcurrency ??
              taskBatchEffectiveConcurrency(
                input.targets
                  .filter((target) => target.environmentId === value.target.environmentId)
                  .flatMap((target) => get(projectAtom(target))?.taskBatches ?? []),
              ),
            position:
              value.entry.state !== "queued"
                ? null
                : entries
                    .filter(
                      (item) =>
                        item.target.environmentId === value.target.environmentId &&
                        item.entry.state === "queued",
                    )
                    .indexOf(value) + 1,
          }));
      }),
  );
  const reconcileBatch = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:reconcile-batch",
    execute: Effect.fn("SavedTaskCommands.reconcileBatch")(
      function* (
        input: { target: ScopedProjectRef; batchId: CommandId },
        registry: AtomRegistry.AtomRegistry,
      ) {
        const batch = registry
          .get(projectAtom(input.target))
          ?.taskBatches?.find((batch) => batch.id === input.batchId);
        if (!batch)
          return yield* new SavedTaskLaunchError({
            detail: "Load the destination batch before reconciling it.",
          });
        return yield* Effect.forEach(
          batch.entries.filter((entry) => entry.state === "running" || entry.state === "settled"),
          (entry) =>
            Effect.gen(function* () {
              const home = {
                environmentId: entry.source.environmentId,
                projectId: entry.source.projectId,
              };
              const receipt: SavedTaskLinkReceipt = {
                home,
                taskId: entry.source.taskId,
                commandId: entry.commandId,
                thread: { environmentId: input.target.environmentId, threadId: entry.threadId },
                userMessageId: entry.userMessageId,
                expectedThreadId: entry.expectedThreadId,
                expectedUserMessageId: entry.expectedUserMessageId,
              };
              return {
                entryId: entry.id,
                result: yield* runInEnvironment(
                  home.environmentId,
                  Effect.gen(function* () {
                    yield* retryLinkEffect(receipt);
                    const snapshot = entry.snapshot;
                    if (snapshot)
                      yield* requestGuarded(WS_METHODS.projectsMutate, {
                        type: "project.update",
                        projectId: home.projectId,
                        commandId: CommandId.make(
                          `task-review:${home.projectId}:${entry.source.taskId}:${snapshot.runId}:${snapshot.outcome}:${snapshot.changes === undefined ? "result" : "checkpoint"}`,
                        ),
                        savedPrompt: {
                          kind: "review",
                          id: entry.source.taskId,
                          threadId: entry.threadId,
                          environmentId: input.target.environmentId,
                          snapshot,
                        },
                      });
                  }),
                ).pipe(Effect.result),
              };
            }),
          { concurrency: 1 },
        );
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });

  const childCountsAtom = Atom.family((source: SavedTaskSource) =>
    Atom.make((get) =>
      taskChildCounts(get(projectAtom(source.home))?.savedPrompts ?? [], source.taskId),
    ),
  );
  return {
    batchStart,
    batchCancel,
    prepareBatch: {
      ...prepareBatch,
      permissionAtom: createCommandPermissions(runtime, WS_METHODS.projectsTaskBatchStart)
        .permissionAtom,
    },
    batchQueueAtom,
    reconcileBatch: { ...reconcileBatch, permissionAtom: permissions.permissionAtom },
    childCountsAtom,
    reconcileReview: { ...reconcileReview, permissionAtom: permissions.permissionAtom },
    requestChanges: { ...requestChanges, permissionAtom: permissions.permissionAtom },
    addMany: { ...addMany, permissionAtom: permissions.permissionAtom },
    quickCreate: { ...quickCreate, permissionAtom: permissions.permissionAtom },
    launch: { ...launch, permissionAtom: permissions.permissionAtom },
    retryLink: { ...retryLink, permissionAtom: permissions.permissionAtom },
    prepareDraft: { ...prepareDraft, permissionAtom: permissions.permissionAtom },
    attachments: {
      ...attachments,
      permissionAtom: createCommandPermissions(runtime, WS_METHODS.projectsTaskAttachments)
        .permissionAtom,
    },
    permissionAtom: permissions.permissionAtom,
  };
}
