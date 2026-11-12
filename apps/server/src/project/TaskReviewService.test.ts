import * as Option from "effect/Option";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  RuntimeRequestId,
  CheckpointId,
  CheckpointScopeId,
  CheckpointRef,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as TaskReviewService from "./TaskReviewService.ts";

const persistence = Layer.mergeAll(
  RuntimeLayer.layerProjectService,
  RuntimeLayer.layerEventSink,
  ProjectionStore.layer,
  ProjectStore.layer,
  EffectOutbox.layer,
).pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "task-review-test-" })),
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
const review = TaskReviewService.layer.pipe(Layer.provideMerge(persistence));
const executor = Layer.effect(
  EffectWorker.OrchestrationEffectExecutorV2,
  Effect.gen(function* () {
    const service = yield* TaskReviewService.TaskReviewService;
    return {
      execute: (effect: EffectOutbox.OrchestrationEffectV2) =>
        effect.request.type === "task.review"
          ? service.reconcile(effect.threadId, effect.request.runId).pipe(
              Effect.mapError(
                (cause) =>
                  new EffectWorker.OrchestrationEffectExecutionError({
                    effectId: effect.id,
                    effectType: effect.request.type,
                    cause,
                  }),
              ),
            )
          : Effect.die("Unexpected effect"),
    };
  }),
).pipe(Layer.provideMerge(review));
const layer = EffectWorker.layer.pipe(Layer.provideMerge(executor));

it.effect.each(["completed", "failed", "interrupted", "waiting", "history"] as const)(
  "records %s after commit, including a turn that finished before linking",
  (scenario) =>
    Effect.gen(function* () {
      const superseded = scenario === "history";
      const status = superseded ? "failed" : scenario;
      const projects = yield* ProjectService.ProjectService;
      const sink = yield* EventSink.EventSinkV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const review = yield* TaskReviewService.TaskReviewService;
      const projectId = ProjectId.make(`project-${status}`);
      const threadId = ThreadId.make(`thread-${status}`);
      const runId = RunId.make(`run-${status}`);
      const messageId = MessageId.make(`message-${status}`);
      const now = DateTime.makeUnsafe("2026-01-01T00:00:10Z");
      const started = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
      yield* projects.create({
        commandId: CommandId.make("create"),
        projectId,
        title: "Demo",
        workspaceRoot: "/repo",
      });
      yield* projects.update({
        commandId: CommandId.make("add"),
        projectId,
        savedPrompt: { kind: "add", id: "task", text: "Implement" },
      });
      const events: OrchestrationV2DomainEvent[] = [
        {
          id: EventId.make("thread-created"),
          type: "thread.created",
          threadId,
          occurredAt: started,
          payload: {
            id: threadId,
            projectId,
            title: "Demo",
            createdBy: "user",
            creationSource: "web",
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: started,
            updatedAt: started,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        },
        {
          id: EventId.make("run-ended"),
          type: "run.created",
          threadId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: messageId,
            rootNodeId: null,
            activeAttemptId: null,
            status: status === "completed" ? status : "running",
            requestedAt: started,
            startedAt: started,
            completedAt: status === "completed" ? now : null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
        {
          id: EventId.make("assistant"),
          type: "message.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: MessageId.make("assistant"),
            threadId,
            runId,
            nodeId: null,
            role: "assistant",
            createdBy: "user",
            creationSource: "web",
            text: "x".repeat(9000),
            attachments: [],
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      ];
      yield* sink.write({ events });
      yield* projects.update({
        commandId: CommandId.make("link"),
        projectId,
        savedPrompt: { kind: "link", id: "task", threadId, userMessageId: messageId },
      });
      if (status === "waiting") {
        const nodeId = NodeId.make("question-node");
        const requestId = RuntimeRequestId.make("question");
        yield* sink.write({
          events: [
            {
              id: EventId.make("node"),
              type: "node.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: nodeId,
                threadId,
                runId,
                rootNodeId: nodeId,
                parentNodeId: null,
                kind: "user_input_request",
                status: "waiting",
                countsForRun: true,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                runtimeRequestId: requestId,
                checkpointScopeId: null,
                startedAt: started,
                completedAt: null,
              },
            },
            {
              id: EventId.make("question"),
              type: "runtime-request.updated",
              threadId,
              nodeId,
              occurredAt: now,
              payload: {
                id: requestId,
                nodeId,
                providerTurnId: null,
                nativeRequestRef: null,
                kind: "user_input",
                status: "pending",
                responseCapability: { type: "message" },
                createdAt: now,
                resolvedAt: null,
              },
            },
          ],
        });
      }
      if (superseded)
        yield* projects.update({
          commandId: CommandId.make("newer-launch"),
          projectId,
          savedPrompt: {
            kind: "link",
            id: "task",
            threadId: ThreadId.make("newer-thread"),
            userMessageId: MessageId.make("newer-message"),
          },
        });
      if (status !== "completed") {
        const terminal = events[1]!;
        if (terminal.type !== "run.created") return assert.fail("Expected a run fixture");
        yield* sink.write({
          events: [
            {
              ...terminal,
              id: EventId.make("run-settled"),
              type: "run.updated",
              payload: {
                ...terminal.payload,
                status,
                completedAt: status === "waiting" ? null : now,
              },
            },
          ],
        });
      }
      yield* worker.drain();
      const task = Option.getOrThrow(yield* projects.getById(projectId))?.savedPrompts?.[0];
      assert.strictEqual(task?.status, superseded ? "in-progress" : "review");
      const snapshot = task?.threadLinks?.find((link) => link.threadId === threadId)?.snapshot;
      assert.strictEqual(task?.completedAt, null);
      assert.strictEqual(snapshot?.outcome, status === "waiting" ? "waiting for input" : status);
      assert.strictEqual(snapshot?.durationMs, 10000);
      assert.strictEqual(snapshot?.assistantMessage?.length, 8000);
      if (!superseded) assert.deepStrictEqual(snapshot, task?.review);
      else assert.strictEqual(task?.latestThreadId, "newer-thread");
      yield* sink.write({
        events: [
          {
            id: EventId.make("checkpoint"),
            type: "checkpoint.captured",
            threadId,
            occurredAt: now,
            payload: {
              id: CheckpointId.make("checkpoint"),
              threadId,
              scopeId: CheckpointScopeId.make("scope"),
              runId,
              nodeId: NodeId.make("root"),
              parentCheckpointId: null,
              ordinalWithinScope: 1,
              appRunOrdinal: 1,
              ref: CheckpointRef.make("refs/t3/test"),
              status: "ready",
              files: [{ path: "file.ts", kind: "modified", additions: 7, deletions: 2 }],
              capturedAt: now,
            },
          },
        ],
      });
      yield* worker.drain();
      assert.deepStrictEqual(
        Option.getOrThrow(yield* projects.getById(projectId)).savedPrompts?.[0]?.threadLinks?.find(
          (link) => link.threadId === threadId,
        )?.snapshot?.changes,
        { count: 1, additions: 7, deletions: 2 },
      );
      if (superseded) return;
      yield* projects.update({
        commandId: CommandId.make("approve"),
        projectId,
        savedPrompt: { kind: "approve", id: "task" },
      });
      yield* review.reconcile(threadId, runId);
      assert.strictEqual(
        Option.getOrThrow(yield* projects.getById(projectId))?.savedPrompts?.[0]?.status,
        "done",
      );
    }).pipe(Effect.provide(layer)),
);
