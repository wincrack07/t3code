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
              expect(input.useProjectDefaultModel).toBe(true);
              return Effect.succeed({ threadId: ThreadId.make("launched") });
            },
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
      Layer.succeed(EnvironmentRegistry, {
        run: (id, effect) =>
          Effect.provideService(effect, EnvironmentSupervisor, supervisors.get(id)),
      } as EnvironmentRegistry["Service"]),
    );
    const projectAtom = (ref: typeof home) =>
      Atom.make({
        ...ref,
        id: ref.projectId,
        repositoryIdentity: { canonicalKey: "github.com/acme/app" },
        savedPrompts: [{ id: "task", text: "Implement login" }],
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
    } finally {
      registry.dispose();
    }
  }),
);
