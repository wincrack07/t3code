import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  type OrchestrationV2ServerCommand,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as McpToolAccessTestkit from "./McpToolAccess.testkit.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";

const threadId = ThreadId.make("thread:status-caller");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:status"),
  requestNamespace: "provider:status",
  thread: {
    threadId,
    providerSessionId: "status-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};

it.effect("sets the caller's own status as one plain line and clears it when empty", () => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const shell = McpToolAccessTestkit.liveThreadShell(threadId);
  return Effect.gen(function* () {
    const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
    yield* service.update(scope, { action: "set_status", status: "  Migrating\n3 of 7\u0007 " });
    yield* service.update(scope, { action: "set_status", status: " " });
    const other = yield* service
      .update(scope, {
        action: "set_status",
        status: "Not mine",
        threadId: ThreadId.make("thread:other"),
      })
      .pipe(Effect.flip);
    assert.equal(other.code, "invalid_request");
    assert.deepEqual(
      dispatched.map((command) =>
        command.type === "thread.metadata.update" ? command.statusText : command.type,
      ),
      ["Migrating 3 of 7", null],
    );
  }).pipe(
    Effect.provide(
      ThreadMetadataMcpService.layer.pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(shell),
            dispatch: (command) => {
              dispatched.push(command);
              return Effect.succeed({ sequence: dispatched.length, storedEvents: [] });
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("attaches declared questions to the running turn and resolves only known ones", () => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const runId = RunId.make("run:questions");
  const shell = {
    ...McpToolAccessTestkit.liveThreadShell(threadId, { activeRunId: runId }),
    openQuestions: [
      {
        id: "merge",
        text: "Merge now?",
        suggestions: ["Merge", "Wait"],
        runId,
        status: "open" as const,
        createdAt: "2026-11-11T00:00:00.000Z",
      },
    ],
  };
  return Effect.gen(function* () {
    const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
    yield* service.openQuestions(scope, {
      action: "declare",
      questions: [{ id: "merge", text: "Merge now?", suggestions: ["Merge", "Wait"] }],
    });
    const unknown = yield* service
      .openQuestions(scope, { action: "resolve", ids: ["missing"] })
      .pipe(Effect.flip);
    assert.equal(unknown.code, "invalid_request");
    const resolved = yield* service.openQuestions(scope, { action: "resolve", ids: ["merge"] });
    assert.deepEqual(resolved.open, ["merge"]);
    assert.deepEqual(
      dispatched.map((command) =>
        command.type === "thread.metadata.update" ? command.openQuestions : command.type,
      ),
      [
        {
          action: "declare",
          runId,
          questions: [{ id: "merge", text: "Merge now?", suggestions: ["Merge", "Wait"] }],
        },
        { action: "set_status", updates: [{ id: "merge", status: "resolved" }] },
      ],
    );
  }).pipe(
    Effect.provide(
      ThreadMetadataMcpService.layer.pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(shell),
            dispatch: (command) => {
              dispatched.push(command);
              return Effect.succeed({ sequence: dispatched.length, storedEvents: [] });
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("records a self move and says the current cwd remains until the turn ends", () => {
  const target = ProjectId.make("project:destination");
  const shell = {
    ...McpToolAccessTestkit.liveThreadShell(threadId),
    pendingProjectMove: {
      projectId: target,
      detachWorktree: false,
      requestedAt: "2026-11-12T00:00:00.000Z",
    },
  };
  return Effect.gen(function* () {
    const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
    const result = yield* service.update(scope, { action: "move", moveToProjectId: target });
    assert.isTrue(result.movesWhenIdle);
    assert.include(result.message, "your cwd has not changed yet");
  }).pipe(
    Effect.provide(
      ThreadMetadataMcpService.layer.pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () => Effect.succeed(shell),
            dispatch: (command) => {
              assert.equal(command.type, "thread.project.move");
              if (command.type === "thread.project.move") assert.equal(command.threadId, threadId);
              return Effect.succeed({ sequence: 1, storedEvents: [] });
            },
          }),
        ),
      ),
    ),
  );
});
