import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Cause from "effect/Cause";
import { vi } from "vite-plus/test";
import { it, expect } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  RunId,
  type TaskBatchStartInput,
  type TaskAttachmentListResult,
  type ProjectTaskBatch,
  type ProjectMutation,
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
    let projectDefaults: TaskAttachmentListResult["projectDefaults"];
    let launches = 0;
    let links = 0;
    let batchStarts = 0;
    const remoteMutations: ProjectMutation[] = [];
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
            [WS_METHODS.projectsTaskAttachments]: (input: { taskId: string }) =>
              Effect.succeed({
                projectDefaults,
                task: {
                  id: input.taskId,
                  createdAt: "2026-01-01T00:00:00Z",
                  completedAt: null,
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
            [WS_METHODS.serverGetHostResources]: () =>
              Effect.succeed({
                sampledAt: 0,
                cpuUtilization: 0.2,
                cpuCount: 8,
                availableMemoryBytes: 8000,
                totalMemoryBytes: 16000,
              }),
            [WS_METHODS.projectsTaskBatchStart]: (input: TaskBatchStartInput) => {
              batchStarts++;
              return Effect.succeed({
                id: input.commandId,
                concurrency: input.concurrency ?? 2,
                createdAt: "2026-01-01T00:00:00Z",
                entries: input.entries.map((entry, index) => ({
                  ...entry,
                  id: String(index),
                  title: entry.brief.title ?? entry.brief.text,
                  commandId: CommandId.make(`${input.commandId}:task:${index}`),
                  threadId: ThreadId.make(`batch-thread-${index}`),
                  userMessageId: MessageId.make(`batch-message-${index}`),
                  state: "queued",
                })),
              } satisfies ProjectTaskBatch);
            },
            [WS_METHODS.filesystemGetMetadata]: () =>
              Effect.succeed({
                entries: [
                  ref.environmentId === home.environmentId ? { kind: "file", byteLength: 5 } : null,
                ],
              }),
            [WS_METHODS.projectsMutate]: (input: ProjectMutation) => {
              if (input.commandId !== "launch:task-link") {
                remoteMutations.push(input);
                return Effect.succeed({});
              }
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
    const makeProjectAtom = (ref: typeof home) =>
      Atom.make({
        ...ref,
        id: ref.projectId,
        repositoryIdentity: { canonicalKey: "github.com/acme/app" },
        savedPrompts: [{ id: "task", text: "Stale cached prompt", attachments: taskAttachments }],
      } as unknown as EnvironmentProject);
    const otherHome = { ...home, projectId: ProjectId.make("other-home") };
    const otherHomeAtom = makeProjectAtom(otherHome);
    const homeAtom = makeProjectAtom(home);
    const targetAtom = makeProjectAtom(target);
    const projectAtom = (ref: typeof home) =>
      ref.projectId === otherHome.projectId
        ? otherHomeAtom
        : ref.environmentId === home.environmentId
          ? homeAtom
          : targetAtom;
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
      taskSettings = undefined;
      const batchInput = {
        commandId: CommandId.make("batch"),
        sources: [
          { home, taskId: "task" },
          { home: otherHome, taskId: "task2" },
        ],
        targets: [home, target],
        distribute: true,
        launch: {
          modelSelection: {
            instanceId: "codex" as import("@t3tools/contracts").ProviderInstanceId,
            model: "test",
          },
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
        },
      };
      taskSettings = undefined;
      registry.set(homeAtom, {
        ...registry.get(homeAtom),
        defaultModelSelection: {
          instanceId: batchInput.launch.modelSelection.instanceId,
          model: "home-free",
        },
        defaultThreadEnvMode: "worktree",
      });
      registry.set(otherHomeAtom, {
        ...registry.get(otherHomeAtom),
        defaultModelSelection: {
          instanceId: batchInput.launch.modelSelection.instanceId,
          model: "other-free",
        },
        defaultThreadEnvMode: "local",
      });
      const distributed = yield* Effect.promise(() =>
        commands.prepareBatch.run(registry, batchInput),
      );
      expect(distributed._tag).toBe("Success");
      if (distributed._tag === "Success")
        expect(distributed.value.map((group) => group.environmentId)).toEqual([
          home.environmentId,
          target.environmentId,
        ]);
      if (distributed._tag === "Success") {
        for (const group of distributed.value)
          for (const entry of group.input.entries) {
            expect(entry.launch.modelSelection.model).toBe(
              entry.source.projectId === home.projectId ? "home-free" : "other-free",
            );
            expect(entry.launch.threadEnvMode).toBe(
              entry.source.projectId === home.projectId ? "worktree" : "local",
            );
          }
      }
      expect(batchStarts).toBe(0);
      const prepared = yield* Effect.promise(() =>
        commands.prepareBatch.run(registry, { ...batchInput, target, distribute: false }),
      );
      expect(prepared._tag).toBe("Success");
      if (prepared._tag !== "Success") return;
      const queued = yield* Effect.promise(() =>
        commands.batchStart.run(registry, prepared.value[0]!),
      );
      expect(queued._tag).toBe("Success");
      if (queued._tag !== "Success") return;
      registry.set(targetAtom, { ...registry.get(targetAtom), taskBatches: [queued.value] });
      expect(
        registry.get(
          commands.batchQueueAtom({
            source: { home: otherHome, taskId: "task2" },
            targets: [home, target],
          }),
        )[0]?.position,
      ).toBe(2);
      const settled: ProjectTaskBatch = {
        ...queued.value,
        entries: queued.value.entries.map((entry, index) => ({
          ...entry,
          state: "settled",
          snapshot: {
            runId: RunId.make(`batch-run-${index}`),
            userMessageId: entry.userMessageId,
            outcome: "completed",
            finishedAt: "2026-01-01T00:00:00Z",
            pullRequests: [],
          },
        })),
      };
      registry.set(targetAtom, { ...registry.get(targetAtom), taskBatches: [settled] });
      for (const _attempt of [0, 1]) {
        const result = yield* Effect.promise(() =>
          commands.reconcileBatch.run(registry, { target, batchId: settled.id }),
        );
        expect(result._tag).toBe("Success");
      }
      expect(
        remoteMutations
          .slice(0, 4)
          .map((input) => (input.type === "project.update" ? input.savedPrompt?.kind : null)),
      ).toEqual(["link", "review", "link", "review"]);
      expect(remoteMutations.slice(0, 4).map((input) => input.commandId)).toEqual(
        remoteMutations.slice(4).map((input) => input.commandId),
      );
      taskAttachments = [
        {
          kind: "stored",
          attachment: {
            type: "image",
            id: "home-only" as import("@t3tools/contracts").ChatAttachmentId,
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        },
      ];
      const pinned = yield* Effect.promise(() =>
        commands.prepareBatch.run(registry, {
          ...batchInput,
          sources: [{ home, taskId: "task" }],
          target,
        }),
      );
      expect(pinned._tag).toBe("Success");
      if (pinned._tag === "Success")
        expect(pinned.value[0]?.environmentId).toBe(home.environmentId);
      taskAttachments = [];
      projectDefaults = {
        defaultModelSelection: { ...batchInput.launch.modelSelection, model: "folded-free" },
        defaultThreadEnvMode: "worktree",
        defaultRuntimeMode: "approval-required",
      };
      const saved: TaskRunSettings = {
        defaultModelSelection: {
          ...batchInput.launch.modelSelection,
          model: "saved",
          options: [{ id: "effort", value: "low" }],
        },
        runtimeMode: "auto-accept-edits",
        threadEnvMode: "local",
      };
      const overrides: TaskRunSettings = {
        defaultModelSelection: {
          ...batchInput.launch.modelSelection,
          model: "override",
          options: [{ id: "effort", value: "high" }],
        },
        runtimeMode: "full-access",
        threadEnvMode: "worktree",
      };
      for (const scenario of [
        {
          settings: undefined,
          overrides: undefined,
          model: projectDefaults.defaultModelSelection,
          runtimeMode: "approval-required",
          mode: "worktree",
        },
        {
          settings: saved,
          overrides: undefined,
          model: saved.defaultModelSelection,
          runtimeMode: "auto-accept-edits",
          mode: "local",
        },
        {
          settings: saved,
          overrides,
          model: overrides.defaultModelSelection,
          runtimeMode: "full-access",
          mode: "worktree",
        },
      ]) {
        taskSettings = scenario.settings;
        const result = yield* Effect.promise(() =>
          commands.prepareBatch.run(registry, {
            ...batchInput,
            sources: [{ home, taskId: "task" }],
            target: home,
            distribute: false,
            ...(scenario.overrides === undefined ? {} : { overrides: scenario.overrides }),
          }),
        );
        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          const entry = result.value[0]!.input.entries[0]!;
          expect(entry.launch.modelSelection).toEqual(scenario.model);
          expect(entry.launch.runtimeMode).toBe(scenario.runtimeMode);
          expect(entry.launch.threadEnvMode).toBe(scenario.mode);
          expect(entry.destination).toEqual(home);
        }
      }
      expect(batchStarts).toBe(1);
      expect(launches).toBe(2);
    } finally {
      registry.dispose();
    }
  }),
);
