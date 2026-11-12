import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Cause from "effect/Cause";
import { vi } from "vite-plus/test";
import { it, expect } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  type OrchestrationV2ThreadLaunchInput,
  type ProjectTaskAttachment,
  type TaskRunSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import { createSavedTaskCommands, SavedTaskLaunchError } from "./tasks.ts";
import type { EnvironmentProject } from "./models.ts";

vi.mock("./commandPermissions.ts", () => ({
  createCommandPermissions: () => ({
    authorize: () => Effect.void,
    permissionAtom: () => Atom.make(true),
  }),
}));

it.effect("retries the link without sending a second turn after the home environment fails", () =>
  Effect.gen(function* () {
    const home = {
      environmentId: EnvironmentId.make("home"),
      projectId: ProjectId.make("home-project"),
    };
    const target = {
      environmentId: EnvironmentId.make("target"),
      projectId: ProjectId.make("target-project"),
    };
    let taskAttachments: ProjectTaskAttachment[] = [];
    let taskSettings: TaskRunSettings | undefined;
    let launches = 0;
    let links = 0;
    const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
    for (const ref of [home, target]) {
      const session = yield* SubscriptionRef.make(
        Option.some({
          client: {
            [ORCHESTRATION_V2_WS_METHODS.launchThread]: (
              input: OrchestrationV2ThreadLaunchInput,
            ) => {
              launches++;
              expect(input.initialMessage?.text).toBe("Implement login");
              expect(input.useProjectDefaultModel).toBe(
                taskSettings?.defaultModelSelection === undefined,
              );
              if (taskSettings?.defaultModelSelection)
                expect(input.modelSelection).toEqual(taskSettings.defaultModelSelection);
              if (taskSettings?.threadEnvMode === "worktree")
                expect(input.workspaceStrategy).toEqual({ type: "worktree", baseRef: "HEAD" });
              return Effect.succeed({ threadId: ThreadId.make("launched") });
            },
            [WS_METHODS.projectsTaskAttachments]: () =>
              Effect.succeed({
                task: {
                  id: "task",
                  text: "Implement login",
                  attachments: taskAttachments,
                  runSettings: taskSettings,
                },
                attachments: taskAttachments.map((attachment) => ({
                  key: attachment.kind === "reference" ? attachment.path : attachment.attachment.id,
                  attachment,
                  missing: false,
                  sizeBytes: 5,
                  isDirectory: false,
                  warning: null,
                })),
              }),
            [WS_METHODS.filesystemGetMetadata]: () =>
              Effect.succeed({
                entries: [
                  ref.environmentId === home.environmentId ? { kind: "file", byteLength: 5 } : null,
                ],
              }),
            [WS_METHODS.projectsMutate]: (input: { commandId: string }) => {
              expect(input.commandId).toBe("launch:task-link");
              return ++links === 1
                ? Effect.fail(new SavedTaskLaunchError({ detail: "Home disconnected" }))
                : Effect.succeed({});
            },
          },
        } as unknown as RpcSession),
      );
      supervisors.set(
        ref.environmentId,
        EnvironmentSupervisor.of({
          target: new BearerConnectionTarget({
            ...ref,
            label: ref.environmentId,
            connectionId: ref.environmentId,
          }),
          session,
        } as EnvironmentSupervisor["Service"]),
      );
    }
    const runtime = Atom.runtime(
      Layer.merge(
        Layer.succeed(
          SecureRandom.SecureRandom,
          SecureRandom.make((size) => new Uint8Array(size)),
        ),
        Layer.succeed(EnvironmentRegistry, {
          run: (id, effect) =>
            Effect.provideService(effect, EnvironmentSupervisor, supervisors.get(id)),
        } as EnvironmentRegistry["Service"]),
      ),
    );
    const projectAtom = (ref: typeof home) =>
      Atom.make({
        ...ref,
        id: ref.projectId,
        repositoryIdentity: { canonicalKey: "github.com/acme/app" },
        savedPrompts: [{ id: "task", text: "Stale cached prompt", attachments: taskAttachments }],
      } as unknown as EnvironmentProject);
    const commands = createSavedTaskCommands(runtime, projectAtom);
    const registry = AtomRegistry.make();
    try {
      const started = yield* Effect.promise(() =>
        commands.launch.run(registry, {
          source: { home, taskId: "task" },
          target,
          launch: { commandId: CommandId.make("launch") } as OrchestrationV2ThreadLaunchInput,
        }),
      );
      expect(started._tag).toBe("Success");
      if (started._tag !== "Success") throw new Error("Launch failed");
      expect(started.value.status).toBe("started-not-linked");
      expect(started.value.receipt.thread).toEqual({
        environmentId: target.environmentId,
        threadId: "launched",
      });
      const linked = yield* Effect.promise(() =>
        commands.retryLink.run(registry, started.value.receipt),
      );
      expect(linked._tag).toBe("Success");
      expect(launches).toBe(1);
      expect(links).toBe(2);
      taskAttachments = [{ kind: "reference", path: "/repo/My File.txt", temporary: false }];
      const draft = yield* Effect.promise(() =>
        commands.prepareDraft.run(registry, { source: { home, taskId: "task" }, target }),
      );
      expect(draft._tag).toBe("Success");
      if (draft._tag === "Success")
        expect(draft.value.text).toBe("Implement login\n\n[My File.txt](/repo/My%20File.txt)");
      const inspection = yield* Effect.promise(() =>
        commands.attachments.run(registry, {
          source: { home, taskId: "task" },
          checkEnvironmentIds: [target.environmentId],
        }),
      );
      expect(inspection._tag).toBe("Success");
      if (inspection._tag === "Success") {
        expect(inspection.value[0]?.homeEnvironmentId).toBe(home.environmentId);
        expect(
          inspection.value[0]?.referenceStates.map((entry) => [entry.environmentId, entry.state]),
        ).toEqual([
          [home.environmentId, "ok"],
          [target.environmentId, "missing"],
        ]);
      }
      taskAttachments = [
        {
          kind: "stored",
          attachment: {
            type: "image",
            id: "stored" as import("@t3tools/contracts").ChatAttachmentId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        },
      ];
      const refused = yield* Effect.promise(() =>
        commands.prepareDraft.run(registry, { source: { home, taskId: "task" }, target }),
      );
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure")
        expect(Cause.squash(refused.cause)).toMatchObject({
          _tag: "TaskAttachmentsHomeOnlyError",
          homeEnvironmentId: home.environmentId,
        });
      expect(launches).toBe(1);
      taskAttachments = [];
      taskSettings = {
        targetEnvironmentId: target.environmentId,
        defaultModelSelection: {
          instanceId: "codex" as import("@t3tools/contracts").ProviderInstanceId,
          model: "saved-model",
        },
        threadEnvMode: "worktree",
      };
      const preferred = yield* Effect.promise(() =>
        commands.launch.run(registry, {
          source: { home, taskId: "task" },
          targets: [target],
          launch: {
            commandId: CommandId.make("launch"),
            modelSelection: taskSettings!.defaultModelSelection!,
            runtimeMode: "full-access",
            interactionMode: "default",
            workspaceStrategy: { type: "root" },
          } as OrchestrationV2ThreadLaunchInput,
        }),
      );
      expect(preferred._tag).toBe("Success");
      if (preferred._tag === "Success")
        expect(preferred.value.receipt.thread.environmentId).toBe(target.environmentId);
      expect(launches).toBe(2);
    } finally {
      registry.dispose();
    }
  }),
);
