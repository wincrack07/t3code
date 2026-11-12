import * as SecureRandom from "effect/crypto/SecureRandom";
import { startThreadTurn, type StartThreadTurnInput } from "../operations/commands.ts";
import { savedTaskDraftContent, taskReviewSnapshot } from "@t3tools/shared/savedTasks";
import {
  CommandId,
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
import type { Atom, AtomRegistry } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request, requestGuarded } from "../rpc/client.ts";
import type { EnvironmentProject } from "./models.ts";
import { createCommandPermissions } from "./commandPermissions.ts";
import { createRuntimeCommand, runInEnvironment, withCommandPermissions } from "./runtime.ts";

export const SavedTaskSource = Schema.Struct({ home: ScopedProjectRef, taskId: Schema.String });
export type SavedTaskSource = typeof SavedTaskSource.Type;
export const SavedTaskLinkReceipt = Schema.Struct({
  ...SavedTaskSource.fields,
  commandId: CommandId,
  thread: ScopedThreadRef,
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
    input: { source: SavedTaskSource; target: ScopedProjectRef },
    registry: AtomRegistry.AtomRegistry,
  ) {
    const home = registry.get(projectAtom(input.source.home));
    const target = registry.get(projectAtom(input.target));
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
    if (
      input.source.home.environmentId !== input.target.environmentId &&
      (task.attachments ?? []).some((item) => item.kind === "stored")
    )
      return yield* new TaskAttachmentsHomeOnlyError({
        homeEnvironmentId: input.source.home.environmentId,
      });
    return savedTaskDraftContent(task);
  });
  const prepareDraft = createRuntimeCommand(runtime, {
    label: "environment-data:tasks:prepare-draft",
    execute: (input: { source: SavedTaskSource; target: ScopedProjectRef }, registry) =>
      draftFor(input, registry).pipe(withCommandPermissions(runtime, registry)),
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
          target: ScopedProjectRef;
          launch: OrchestrationV2ThreadLaunchInput;
        },
        registry: AtomRegistry.AtomRegistry,
      ) {
        const draft = yield* draftFor(input, registry);
        yield* permissions.authorize(registry, input.source.home.environmentId);
        yield* permissions.authorize(registry, input.target.environmentId);
        const { savedPromptId: _savedPromptId, ...launchInput } = input.launch;
        const result = yield* runInEnvironment(
          input.target.environmentId,
          request(ORCHESTRATION_V2_WS_METHODS.launchThread, {
            ...launchInput,
            title: draft.title,
            initialMessage: { text: draft.text, attachments: draft.attachments },
            projectId: input.target.projectId,
            useProjectDefaultModel: true,
          }),
        );
        const receipt: SavedTaskLinkReceipt = {
          ...input.source,
          commandId: input.launch.commandId,
          ...(result.projection?.runs.at(-1) === undefined
            ? {}
            : { userMessageId: result.projection.runs.at(-1)!.userMessageId }),
          thread: { environmentId: input.target.environmentId, threadId: result.threadId },
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
    execute: (input: { home: ScopedProjectRef; commandId: CommandId; text: string }, registry) =>
      runInEnvironment(
        input.home.environmentId,
        requestGuarded(WS_METHODS.projectsMutate, {
          type: "project.update",
          projectId: input.home.projectId,
          commandId: input.commandId,
          savedPrompt: { kind: "add", id: String(input.commandId), text: input.text },
        }),
      ).pipe(withCommandPermissions(runtime, registry)),
  });
  return {
    reconcileReview: { ...reconcileReview, permissionAtom: permissions.permissionAtom },
    requestChanges: { ...requestChanges, permissionAtom: permissions.permissionAtom },
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
