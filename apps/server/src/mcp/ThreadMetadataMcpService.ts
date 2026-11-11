import {
  CommandId,
  OrchestratorMcpFailure,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type ThreadMetadataMcpAction,
  type ThreadMetadataMcpUpdateInput,
  type ThreadMetadataMcpUpdateResult,
  type ThreadOpenQuestionsMcpInput,
  type ThreadOpenQuestionsMcpResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { threadNotFound } from "./threadAccess.ts";

export class ThreadMetadataMcpService extends Context.Service<
  ThreadMetadataMcpService,
  {
    readonly update: (
      scope: McpInvocationScope,
      input: ThreadMetadataMcpUpdateInput,
    ) => Effect.Effect<ThreadMetadataMcpUpdateResult, OrchestratorMcpFailure>;
    /** Attaches or closes non-blocking questions on the caller's own thread. */
    readonly openQuestions: (
      scope: McpInvocationScope,
      input: ThreadOpenQuestionsMcpInput,
    ) => Effect.Effect<ThreadOpenQuestionsMcpResult, OrchestratorMcpFailure>;
  }
>()("t3/mcp/ThreadMetadataMcpService") {}

function failure(code: OrchestratorMcpFailure["code"], message: string): OrchestratorMcpFailure {
  return new OrchestratorMcpFailure({ code, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stablePart(value: string): string {
  return encodeURIComponent(value);
}

function commandId(input: {
  readonly scope: McpInvocationScope;
  readonly threadId: ThreadId;
  readonly action: ThreadMetadataMcpAction | "open-questions";
  readonly requestKey: string;
}): CommandId {
  return CommandId.make(
    [
      "command",
      "mcp",
      stablePart(input.scope.requestNamespace),
      "thread-update",
      stablePart(input.threadId),
      stablePart(input.action),
      stablePart(input.requestKey),
    ].join(":"),
  );
}

function metadataCommand(input: {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly update: ThreadMetadataMcpUpdateInput;
}): Extract<OrchestrationV2Command, { readonly type: "thread.metadata.update" }> {
  switch (input.update.action) {
    case "rename":
      return {
        type: "thread.metadata.update",
        commandId: input.commandId,
        threadId: input.threadId,
        title: input.update.title!,
      };
    case "regenerate_title":
      return {
        type: "thread.metadata.update",
        commandId: input.commandId,
        threadId: input.threadId,
        regenerateTitle: true,
      };
    case "set_status":
      return {
        type: "thread.metadata.update",
        commandId: input.commandId,
        threadId: input.threadId,
        statusText: normalizeStatusText(input.update.status ?? ""),
      };
  }
}

/** One plain line: whitespace runs collapse and control characters drop, so it renders as typed. */
function normalizeStatusText(status: string): string | null {
  return (
    status
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim() || null
  );
}

function resultFromThread(input: {
  readonly action: ThreadMetadataMcpAction;
  readonly commandId: CommandId;
  readonly sequence: number;
  readonly thread: Pick<
    OrchestrationV2AppThread,
    "id" | "title" | "statusText" | "titleRegeneration" | "linkedPullRequest" | "updatedAt"
  >;
}): ThreadMetadataMcpUpdateResult {
  return {
    threadId: input.thread.id,
    action: input.action,
    commandId: input.commandId,
    sequence: input.sequence,
    title: input.thread.title,
    statusText: input.thread.statusText ?? null,
    titleRegeneration:
      input.thread.titleRegeneration === undefined || input.thread.titleRegeneration === null
        ? null
        : {
            requestId: input.thread.titleRegeneration.requestId,
            startedAt: DateTime.formatIso(input.thread.titleRegeneration.startedAt),
          },
    linkedPullRequest: input.thread.linkedPullRequest ?? null,
    updatedAt: DateTime.formatIso(input.thread.updatedAt),
  };
}

const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;

  const update = Effect.fn("ThreadMetadataMcpService.update")(function* (
    scope: McpInvocationScope,
    input: ThreadMetadataMcpUpdateInput,
  ) {
    if (!scope.capabilities.has("orchestration")) {
      return yield* failure(
        "capability_denied",
        "This MCP credential does not grant orchestration capabilities.",
      );
    }

    if (
      input.action === "set_status" &&
      input.threadId !== undefined &&
      input.threadId !== scope.thread?.threadId
    ) {
      return yield* failure(
        "invalid_request",
        "set_status only changes your own thread's status. Omit threadId.",
      );
    }
    const threadId = input.threadId ?? scope.thread?.threadId;
    if (threadId === undefined) {
      return yield* failure(
        "target_required",
        "Pass threadId: this MCP client is not running inside a T3 thread.",
      );
    }
    const shell = yield* threadManagement
      .getThreadShell(threadId)
      .pipe(
        Effect.mapError((error) =>
          failure(
            "orchestration_error",
            `Unable to locate thread ${threadId}: ${errorMessage(error)}`,
          ),
        ),
      );
    if (shell === null || shell.deletedAt !== null) {
      return yield* threadNotFound(threadManagement, threadId, `Thread ${threadId} was not found.`);
    }
    const requestKey =
      input.clientRequestId === undefined ? yield* random.uuidV4() : input.clientRequestId;
    const updateCommandId = commandId({
      scope,
      threadId,
      action: input.action,
      requestKey,
    });
    const dispatched = yield* threadManagement
      .dispatch(
        metadataCommand({
          commandId: updateCommandId,
          threadId,
          update: input,
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          failure(
            "orchestration_error",
            `Unable to ${input.action} for thread ${threadId}: ${errorMessage(error)}`,
          ),
        ),
      );
    const metadataEvent = dispatched.storedEvents.find(
      (stored) => stored.event.type === "thread.metadata-updated",
    );
    // Retries may find stored events compacted away; answer from the projection.
    const thread =
      metadataEvent?.event.type === "thread.metadata-updated"
        ? metadataEvent.event.payload
        : yield* threadManagement
            .getThreadShell(threadId)
            .pipe(Effect.mapError((error) => failure("orchestration_error", errorMessage(error))));
    if (thread === null) {
      return yield* failure(
        "orchestration_error",
        `Thread ${threadId} metadata update completed without a resultant state.`,
      );
    }
    return resultFromThread({
      action: input.action,
      commandId: updateCommandId,
      sequence: dispatched.sequence,
      thread,
    });
  });

  const openQuestions = Effect.fn("ThreadMetadataMcpService.openQuestions")(function* (
    scope: McpInvocationScope,
    input: ThreadOpenQuestionsMcpInput,
  ) {
    if (!scope.capabilities.has("orchestration")) {
      return yield* failure(
        "capability_denied",
        "This MCP credential does not grant orchestration capabilities.",
      );
    }
    const threadId = scope.thread?.threadId;
    if (threadId === undefined) {
      return yield* failure(
        "target_required",
        "Open questions attach to your own thread; this MCP client is not running inside one.",
      );
    }
    const shell = yield* threadManagement
      .getThreadShell(threadId)
      .pipe(Effect.mapError((error) => failure("orchestration_error", errorMessage(error))));
    if (shell === null || shell.deletedAt !== null) {
      return yield* threadNotFound(threadManagement, threadId, `Thread ${threadId} was not found.`);
    }
    const known = new Set((shell.openQuestions ?? []).map((question) => question.id));
    const unknown = (input.ids ?? []).filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return yield* failure("invalid_request", `No open question with id ${unknown.join(", ")}.`);
    }
    const requestKey =
      input.clientRequestId === undefined ? yield* random.uuidV4() : input.clientRequestId;
    const dispatched = yield* threadManagement
      .dispatch({
        type: "thread.metadata.update",
        commandId: commandId({ scope, threadId, action: "open-questions", requestKey }),
        threadId,
        openQuestions:
          input.action === "declare"
            ? {
                action: "declare",
                runId: shell.activeRunId ?? shell.latestRunId,
                questions: input.questions ?? [],
              }
            : {
                action: "set_status",
                updates: (input.ids ?? []).map((id) => ({ id, status: "resolved" as const })),
              },
      })
      .pipe(Effect.mapError((error) => failure("orchestration_error", errorMessage(error))));
    const event = dispatched.storedEvents.find(
      (stored) => stored.event.type === "thread.metadata-updated",
    );
    const thread =
      event?.event.type === "thread.metadata-updated"
        ? event.event.payload
        : yield* threadManagement
            .getThreadShell(threadId)
            .pipe(Effect.mapError((error) => failure("orchestration_error", errorMessage(error))));
    return {
      threadId,
      open: (thread?.openQuestions ?? [])
        .filter((question) => question.status === "open")
        .map((question) => question.id),
    };
  });

  return ThreadMetadataMcpService.of({ update, openQuestions });
});

export const layer: Layer.Layer<
  ThreadMetadataMcpService,
  never,
  SecureRandom.SecureRandom | ThreadManagementService.ThreadManagementService
> = Layer.effect(ThreadMetadataMcpService, make);
