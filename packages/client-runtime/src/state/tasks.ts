import {
  CommandId,
  repositoryGroupingKeyOf,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  type OrchestrationV2ThreadLaunchInput,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
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
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  projectAtom: (ref: ScopedProjectRef) => Atom.Atom<EnvironmentProject | null>,
) {
  const permissions = createCommandPermissions(runtime, WS_METHODS.projectsMutate);
  const retryLinkEffect = Effect.fn("SavedTaskCommands.link")(function* (
    receipt: SavedTaskLinkReceipt,
  ) {
    yield* requestGuarded(WS_METHODS.projectsMutate, {
      type: "project.update",
      commandId: CommandId.make(`${receipt.commandId}:task-link`),
      projectId: receipt.home.projectId,
      savedPrompt: {
        kind: "link",
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
        const home = registry.get(projectAtom(input.source.home));
        const target = registry.get(projectAtom(input.target));
        const task = home?.savedPrompts?.find((task) => task.id === input.source.taskId);
        if (!home || !target || !task)
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
        yield* permissions.authorize(registry, input.source.home.environmentId);
        yield* permissions.authorize(registry, input.target.environmentId);
        const { savedPromptId: _savedPromptId, ...launchInput } = input.launch;
        const result = yield* runInEnvironment(
          input.target.environmentId,
          request(ORCHESTRATION_V2_WS_METHODS.launchThread, {
            ...launchInput,
            title: task.title ?? task.text.split("\n")[0]!.slice(0, 160),
            initialMessage: { text: task.text, attachments: [] },
            projectId: input.target.projectId,
            useProjectDefaultModel: true,
          }),
        );
        const receipt: SavedTaskLinkReceipt = {
          ...input.source,
          commandId: input.launch.commandId,
          thread: { environmentId: input.target.environmentId, threadId: result.threadId },
        };
        return yield* runInEnvironment(receipt.home.environmentId, retryLinkEffect(receipt)).pipe(
          Effect.orElseSucceed(() => ({ status: "started-not-linked" as const, receipt })),
        );
      },
      (effect, _input, registry) => effect.pipe(withCommandPermissions(runtime, registry)),
    ),
  });
  return { launch, retryLink, permissionAtom: permissions.permissionAtom };
}
