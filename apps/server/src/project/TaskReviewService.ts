import * as Option from "effect/Option";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { CommandId, type RunId, type ThreadId } from "@t3tools/contracts";
import { taskReviewSnapshot } from "@t3tools/shared/savedTasks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

export class TaskReviewError extends Schema.TaggedError<TaskReviewError>()("TaskReviewError", {
  threadId: Schema.String,
  cause: Schema.Defect(),
}) {}
export class TaskReviewService extends Context.Service<
  TaskReviewService,
  {
    readonly reconcile: (threadId: ThreadId, runId: RunId) => Effect.Effect<void, TaskReviewError>;
  }
>()("t3/project/TaskReviewService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const store = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const identity = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironmentIdentity);
  return TaskReviewService.of({
    reconcile: Effect.fn("TaskReviewService.reconcile")(
      function* (threadId, runId) {
        const environmentId = Option.isSome(identity)
          ? yield* identity.value.getEnvironmentId
          : undefined;
        const rows = yield* store.list();
        const homes = rows.filter((row) =>
          row.savedPrompts?.some(
            (task) =>
              task.deletedAt === undefined &&
              task.latestThreadId === threadId &&
              (task.latestThreadEnvironmentId === undefined ||
                task.latestThreadEnvironmentId === environmentId) &&
              (task.status === "in-progress" || task.status === "review"),
          ),
        );
        if (homes.length === 0) return;
        const projection = yield* projections.getThreadProjection(threadId);
        const snapshot = taskReviewSnapshot(projection, runId);
        if (!snapshot) return;
        for (const row of homes)
          for (const task of row.savedPrompts ?? []) {
            if (
              task.deletedAt !== undefined ||
              task.latestThreadId !== threadId ||
              (task.latestThreadEnvironmentId !== undefined &&
                task.latestThreadEnvironmentId !== environmentId) ||
              (task.status !== "in-progress" && task.status !== "review")
            )
              continue;
            yield* projects.update({
              projectId: row.projectId,
              commandId: CommandId.make(
                `task-review:${row.projectId}:${task.id}:${runId}:${snapshot.outcome}:${snapshot.changes === undefined ? "result" : "checkpoint"}`,
              ),
              savedPrompt: {
                kind: "review",
                id: task.id,
                threadId,
                ...(task.latestThreadEnvironmentId === undefined
                  ? {}
                  : { environmentId: task.latestThreadEnvironmentId }),
                snapshot,
              },
            });
          }
      },
      (effect, threadId) =>
        effect.pipe(Effect.mapError((cause) => new TaskReviewError({ threadId, cause }))),
    ),
  });
});
export const layer = Layer.effect(TaskReviewService, make);
