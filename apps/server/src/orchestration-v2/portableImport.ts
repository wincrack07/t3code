import {
  MessageId,
  TurnItemId,
  type T3ThreadExport,
  type ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";

export function portableImportRecords(threadId: ThreadId, bundle: T3ThreadExport) {
  const entries = [
    {
      role: "assistant" as const,
      text: `Imported from ${bundle.source.label} · ${bundle.createdAt}. Attachment bytes and tool output are not included.`,
      timestamp: bundle.createdAt,
      attachments: [],
    },
    ...bundle.conversation,
  ];
  return entries.map((entry, ordinal) => {
    const timestamp = DateTime.makeUnsafe(entry.timestamp);
    const role = entry.role === "user" ? "user" : "assistant";
    const messageId = MessageId.make(`${threadId}:message:${ordinal}`);
    const text = `${entry.role === "plan" ? "Plan:\n\n" : ""}${entry.text}${entry.attachments.length ? `\n\nAttachments (not restored): ${entry.attachments.map((a) => a.name).join(", ")}` : ""}`;
    const message: OrchestrationV2ConversationMessage = {
      id: messageId,
      threadId,
      runId: null,
      nodeId: null,
      createdBy: role === "user" ? "user" : "agent",
      creationSource: "server",
      role,
      text,
      attachments: [],
      streaming: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const base = {
      id: TurnItemId.make(`${threadId}:item:${ordinal}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status: "completed" as const,
      title: null,
      startedAt: timestamp,
      completedAt: timestamp,
      updatedAt: timestamp,
      messageId,
      text,
    };
    const item: OrchestrationV2TurnItem =
      role === "user"
        ? {
            ...base,
            type: "user_message",
            createdBy: "user",
            creationSource: "server",
            inputIntent: "turn_start",
            attachments: [],
          }
        : { ...base, type: "assistant_message", streaming: false };
    return { message, item };
  });
}

export const exportedRepository = Effect.fnUntraced(function* (
  workspaceRoot: string | undefined,
  enrichment: Option.Option<ProjectEnrichmentService.ProjectEnrichmentService["Service"]>,
) {
  if (workspaceRoot === undefined || Option.isNone(enrichment)) return {};
  const identity = yield* enrichment.value.readRepositoryIdentity(workspaceRoot);
  if (identity === null) return {};
  return {
    repository: {
      canonicalKey: identity.canonicalKey,
      ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
    },
  };
});
