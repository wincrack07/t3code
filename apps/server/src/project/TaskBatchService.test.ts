import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  type TaskBatchStartInput,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as TaskReviewService from "./TaskReviewService.ts";
import * as TaskBatchService from "./TaskBatchService.ts";

const home = EnvironmentId.make("home");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const persistence = Layer.mergeAll(
  RuntimeLayer.layerProjectService,
  RuntimeLayer.layerEventSink,
  ProjectionStore.layer,
  ProjectStore.layer,
  EffectOutbox.layer,
).pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "task-batch-test-" })),
  Layer.provide(
    Layer.mock(WorkspacePaths.WorkspacePaths)({ normalizeWorkspaceRoot: Effect.succeed }),
  ),
  Layer.provide(
    Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({
      request: () => Effect.void,
      invalidate: () => Effect.void,
      getAvailable: () =>
        Effect.succeed({
          repositoryIdentity: null,
          faviconPath: null,
          repositoryIdentityResolved: false,
        }),
      peek: () =>
        Effect.succeed({
          repositoryIdentity: null,
          faviconPath: null,
          repositoryIdentityResolved: false,
        }),
    }),
  ),
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);
function harness(options: { crashAfterAccept?: boolean; failTitle?: string } = {}) {
  const accepted = new Set<CommandId>();
  const attempts: CommandId[] = [];
  let crashed = false;
  const launches = Layer.effect(
    ThreadLaunchService.ThreadLaunchService,
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      return ThreadLaunchService.ThreadLaunchService.of({
        prepareRun: () => Effect.void,
        checkWorktreeBase: () => Effect.void,
        retryPreparation: () => Effect.die("Unused fixture preparation"),
        launch: Effect.fn("TaskBatchTest.launch")(function* (input) {
          attempts.push(input.commandId);
          const threadId = input.threadId;
          const messageId = input.initialMessage?.messageId;
          if (!threadId || !messageId) return yield* Effect.die("Batch launch ids are required");
          if (input.title === options.failTitle)
            return yield* new ThreadLaunchService.ThreadLaunchError({
              operation: "resolve-project",
              commandId: input.commandId,
              projectId: input.projectId,
              cause: "expected fixture failure",
            });
          if (!accepted.has(input.commandId)) {
            const runId = RunId.make(`run:${input.commandId}`);
            const events: OrchestrationV2DomainEvent[] = [
              {
                id: EventId.make(`thread:${input.commandId}`),
                type: "thread.created",
                threadId,
                occurredAt: at,
                payload: {
                  id: threadId,
                  projectId: input.projectId,
                  title: input.title,
                  createdBy: "user",
                  creationSource: "web",
                  providerInstanceId: input.modelSelection.instanceId,
                  modelSelection: input.modelSelection,
                  runtimeMode: input.runtimeMode,
                  interactionMode: input.interactionMode,
                  branch: null,
                  worktreePath: null,
                  activeProviderThreadId: null,
                  lineage: {
                    parentThreadId: null,
                    relationshipToParent: null,
                    rootThreadId: threadId,
                  },
                  forkedFrom: null,
                  createdAt: at,
                  updatedAt: at,
                  archivedAt: null,
                  settledOverride: null,
                  settledAt: null,
                  lastVisitedAt: null,
                  deletedAt: null,
                },
              },
              {
                id: EventId.make(`run:${input.commandId}`),
                type: "run.created",
                threadId,
                occurredAt: at,
                payload: {
                  id: runId,
                  threadId,
                  ordinal: 1,
                  providerInstanceId: input.modelSelection.instanceId,
                  modelSelection: input.modelSelection,
                  providerThreadId: null,
                  userMessageId: messageId,
                  rootNodeId: null,
                  activeAttemptId: null,
                  status: "running",
                  requestedAt: at,
                  startedAt: at,
                  completedAt: null,
                  checkpointId: null,
                  contextHandoffId: null,
                },
              },
            ];
            yield* sink.write({ events }).pipe(Effect.orDie);
            accepted.add(input.commandId);
            if (options.crashAfterAccept && !crashed) {
              crashed = true;
              return yield* Effect.die("Simulated process loss after acceptance");
            }
          }
          return {
            threadId,
            projection: yield* projections.getThreadProjection(threadId).pipe(Effect.orDie),
            resumed: attempts.filter((id) => id === input.commandId).length > 1,
          };
        }),
      });
    }),
  ).pipe(Layer.provideMerge(persistence));
  const services = Layer.mergeAll(TaskBatchService.layer, TaskReviewService.layer).pipe(
    Layer.provideMerge(launches),
    Layer.provideMerge(
      Layer.merge(
        NodeCrypto.layer,
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(home),
        }),
      ),
    ),
  );
  const executor = Layer.effect(
    EffectWorker.OrchestrationEffectExecutorV2,
    Effect.gen(function* () {
      const batches = yield* TaskBatchService.TaskBatchService;
      const reviews = yield* TaskReviewService.TaskReviewService;
      return {
        execute: Effect.fn("TaskBatchTest.execute")(
          function* (effect: EffectOutbox.OrchestrationEffectV2) {
            if (effect.request.type === "task.batch-pump") yield* batches.pump();
            else if (effect.request.type === "task.review")
              yield* reviews.reconcile(effect.threadId, effect.request.runId);
            else return yield* Effect.die("Unexpected fixture effect");
          },
          (effect, request) =>
            effect.pipe(
              Effect.mapError(
                (cause) =>
                  new EffectWorker.OrchestrationEffectExecutionError({
                    effectId: request.id,
                    effectType: request.request.type,
                    cause,
                  }),
              ),
            ),
        ),
      };
    }),
  ).pipe(Layer.provideMerge(services));
  return { layer: EffectWorker.layer.pipe(Layer.provideMerge(executor)), accepted, attempts };
}
const seed = Effect.fn("TaskBatchTest.seed")(function* (
  name: string,
  count: number,
  concurrency?: number,
) {
  const projects = yield* ProjectService.ProjectService;
  const projectId = ProjectId.make(name);
  yield* projects.create({
    commandId: CommandId.make(`create:${name}`),
    projectId,
    title: name,
    workspaceRoot: `/repo/${name}`,
  });
  const entries: TaskBatchStartInput["entries"][number][] = [];
  for (let index = 0; index < count; index++) {
    const id = `${name}-${index}`;
    yield* projects.update({
      projectId,
      commandId: CommandId.make(`add:${id}`),
      savedPrompt: { kind: "add", id, text: id, title: id },
    });
    entries.push({
      source: { environmentId: home, projectId, taskId: id },
      brief: { id, text: id, title: id, createdAt: DateTime.formatIso(at), completedAt: null },
      launch: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
    });
  }
  return {
    commandId: CommandId.make(`batch:${name}`),
    projectId,
    entries,
    ...(concurrency === undefined ? {} : { concurrency }),
  } satisfies TaskBatchStartInput;
});
const read = Effect.fn("TaskBatchTest.read")(function* (input: TaskBatchStartInput) {
  const store = yield* ProjectStore.ProjectStoreV2;
  return Option.getOrThrow(yield* store.get(input.projectId)).taskBatches!.find(
    (batch) => batch.id === input.commandId,
  )!;
});
it.effect.each([undefined, 1, 4])(
  "enforces cap %s, persists the queue, and promotes after committed settlement",
  (cap) => {
    const fixture = harness();
    return Effect.gen(function* () {
      const batches = yield* TaskBatchService.TaskBatchService;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const input = yield* seed("limits", 5, cap);
      yield* batches.start(input);
      yield* batches.start(input);
      assert.strictEqual(fixture.accepted.size, 0);
      yield* worker.drain();
      const limit = cap ?? 2;
      const state = yield* read(input);
      assert.strictEqual(state.entries.filter((entry) => entry.state === "running").length, limit);
      assert.strictEqual(
        state.entries.filter((entry) => entry.state === "queued").length,
        5 - limit,
      );
      assert.strictEqual(fixture.accepted.size, limit);
      assert.isUndefined(state.entries[0]?.brief);
      const first = state.entries[0]!;
      const projection = yield* projections.getThreadProjection(first.threadId);
      const run = projection.runs[0]!;
      yield* sink.write({
        events: [
          {
            id: EventId.make("settled"),
            type: "run.updated",
            threadId: first.threadId,
            occurredAt: at,
            payload: { ...run, status: "completed", completedAt: at },
          },
        ],
      });
      yield* worker.drain();
      const promoted = yield* read(input);
      assert.strictEqual(promoted.entries[0]?.state, "settled");
      assert.strictEqual(
        promoted.entries.filter((entry) => entry.state === "running").length,
        limit,
      );
      assert.strictEqual(fixture.accepted.size, limit + 1);
      yield* batches.start(input);
      yield* worker.drain();
      assert.strictEqual(fixture.accepted.size, limit + 1);
    }).pipe(Effect.provide(fixture.layer));
  },
);
it.effect("recovers a starting entry after acceptance without accepting a second launch", () => {
  const fixture = harness({ crashAfterAccept: true });
  return Effect.gen(function* () {
    const batches = yield* TaskBatchService.TaskBatchService;
    const earlierProject = yield* seed("earlier-project", 1, 1);
    const input = yield* seed("restart", 1, 1);
    yield* batches.start(input);
    assert.isTrue(Exit.isFailure(yield* batches.pump().pipe(Effect.exit)));
    assert.strictEqual((yield* read(input)).entries[0]?.state, "starting");
    yield* batches.start(earlierProject);
    yield* Effect.gen(function* () {
      const restarted = yield* TaskBatchService.TaskBatchService;
      yield* restarted.pump();
    }).pipe(Effect.provide(TaskBatchService.layer));
    assert.strictEqual((yield* read(input)).entries[0]?.state, "running");
    assert.strictEqual(fixture.accepted.size, 1);
    assert.strictEqual(fixture.attempts.length, 2);
  }).pipe(Effect.provide(fixture.layer));
});
it.effect(
  "cancels queued entries, keeps running threads, and continues after a failed launch",
  () => {
    const fixture = harness({ failTitle: "failures-0" });
    return Effect.gen(function* () {
      const batches = yield* TaskBatchService.TaskBatchService;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const input = yield* seed("failures", 5, 1);
      yield* batches.start(input);
      yield* batches.cancel({
        commandId: CommandId.make("cancel-one"),
        projectId: input.projectId,
        batchId: input.commandId,
        entryId: "1",
      });
      yield* worker.drain();
      const state = yield* read(input);
      assert.strictEqual(state.entries[0]?.state, "failed-to-start");
      assert.include(state.entries[0]!.reason!, "resolve-project");
      assert.strictEqual(state.entries[1]?.state, "cancelled");
      assert.strictEqual(state.entries[2]?.state, "running");
      yield* batches.cancel({
        commandId: CommandId.make("cancel-all"),
        projectId: input.projectId,
        batchId: input.commandId,
      });
      yield* worker.drain();
      assert.deepStrictEqual(
        (yield* read(input)).entries.map((entry) => entry.state),
        ["failed-to-start", "cancelled", "running", "cancelled", "cancelled"],
      );
      assert.strictEqual(fixture.accepted.size, 1);
    }).pipe(Effect.provide(fixture.layer));
  },
);
it.effect(
  "shares the environment cap across projects and rejects invalid limits and remote stored attachments",
  () => {
    const fixture = harness();
    return Effect.gen(function* () {
      const batches = yield* TaskBatchService.TaskBatchService;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const first = yield* seed("first", 2, 2);
      const second = yield* seed("second", 3, 4);
      assert.strictEqual(
        (yield* batches.start({ ...first, concurrency: 5 }).pipe(Effect.flip)).reason,
        "invalid-input",
      );
      const remote = {
        ...first,
        entries: first.entries.map((entry) => ({
          ...entry,
          source: { ...entry.source, environmentId: EnvironmentId.make("remote") },
          brief: {
            ...entry.brief,
            attachments: [
              {
                kind: "stored" as const,
                attachment: {
                  type: "image" as const,
                  id: "stored" as import("@t3tools/contracts").ChatAttachmentId,
                  name: "image.png",
                  mimeType: "image/png",
                  sizeBytes: 5,
                },
              },
            ],
          },
        })),
      };
      assert.strictEqual(
        (yield* batches.start(remote).pipe(Effect.flip)).reason,
        "home-only-attachments",
      );
      yield* batches.start(first);
      assert.strictEqual(
        (yield* batches
          .start({ ...first, commandId: CommandId.make("duplicate") })
          .pipe(Effect.flip)).reason,
        "invalid-input",
      );
      yield* batches.start(second);
      yield* worker.drain();
      assert.strictEqual(fixture.accepted.size, 2);
      assert.strictEqual(
        (yield* read(second)).entries.filter((entry) => entry.state === "queued").length,
        3,
      );
    }).pipe(Effect.provide(fixture.layer));
  },
);
