import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2ThreadProjection,
  RunId,
  TaskReviewSnapshot,
  ProjectSavedPrompt,
  OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import { serializeComposerFileLink } from "./composerTrigger.ts";
export function savedTaskDraftContent(task: ProjectSavedPrompt) {
  const references = (task.attachments ?? []).flatMap((item) =>
    item.kind === "reference" ? [serializeComposerFileLink(item.path)] : [],
  );
  return {
    title: task.title ?? task.text.split("\n")[0]!.slice(0, 160),
    text: [
      task.text,
      ...(task.acceptanceCriteria?.length
        ? [
            "<acceptance_criteria>\n" +
              task.acceptanceCriteria
                .map((item) => `- [${item.done ? "x" : " "}] ${item.text.replace(/\s+/g, " ")}`)
                .join("\n") +
              "\n</acceptance_criteria>",
          ]
        : []),
      ...references,
    ].join("\n\n"),
    attachments: (task.attachments ?? []).flatMap((item) =>
      item.kind === "stored" ? [item.attachment] : [],
    ),
  };
}

export function taskReviewSnapshot(
  projection: OrchestrationV2ThreadProjection,
  runId: RunId,
): TaskReviewSnapshot | undefined {
  const run = projection.runs.find((item) => item.id === runId);
  if (
    !run ||
    projection.runs.some((item) => item.ordinal > run.ordinal && item.status !== "queued")
  )
    return;
  const waiting = projection.runtimeRequests.find(
    (request) =>
      request.kind === "user_input" &&
      request.status === "pending" &&
      projection.nodes.some((node) => node.id === request.nodeId && node.runId === run.id),
  );
  const outcome = waiting
    ? "waiting for input"
    : run.status === "completed"
      ? "completed"
      : run.status === "failed"
        ? "failed"
        : ["interrupted", "cancelled", "rolled_back"].includes(run.status)
          ? "interrupted"
          : undefined;
  const finishedAt = run.completedAt ?? waiting?.createdAt;
  if (!outcome || !finishedAt) return;
  const assistant = projection.messages
    .filter(
      (message) => message.runId === run.id && message.role === "assistant" && !message.streaming,
    )
    .at(-1);
  const checkpoint = projection.checkpoints
    .filter((item) => item.runId === run.id && item.status === "ready")
    .at(-1);
  return {
    runId: run.id,
    userMessageId: run.userMessageId,
    outcome,
    finishedAt: DateTime.formatIso(finishedAt),
    ...(run.startedAt === null
      ? {}
      : {
          durationMs: Math.max(
            0,
            DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(run.startedAt),
          ),
        }),
    ...(assistant === undefined ? {} : { assistantMessage: assistant.text.slice(0, 8000) }),
    ...(checkpoint === undefined
      ? {}
      : {
          changes: checkpoint.filesTotal ?? {
            count: checkpoint.files.length,
            additions: checkpoint.files.reduce((n, file) => n + file.additions, 0),
            deletions: checkpoint.files.reduce((n, file) => n + file.deletions, 0),
          },
        }),
    pullRequests: (projection.thread.pullRequests ?? [])
      .filter((link) => link.source !== "stack-dismissed")
      .slice(0, 10)
      .map((link) => ({
        number: link.number,
        url: link.url,
        ...(link.snapshot === null ? {} : { state: link.snapshot.state }),
      })),
  };
}

export function taskChildCounts(tasks: ReadonlyArray<ProjectSavedPrompt>, parentId: string) {
  const children = tasks.filter(
    (task) => task.deletedAt === undefined && task.parentTaskId === parentId,
  );
  return {
    total: children.length,
    done: children.filter(
      (task) => task.status === "done" || (task.status === undefined && task.completedAt !== null),
    ).length,
  };
}

type LaunchSettings = Pick<
  OrchestrationV2ThreadLaunchInput,
  "modelSelection" | "runtimeMode" | "interactionMode" | "workspaceStrategy"
>;
export function savedTaskLaunchSettings(
  task: Pick<ProjectSavedPrompt, "runSettings">,
  fallback: LaunchSettings,
  overrides: NonNullable<OrchestrationV2ThreadLaunchInput["taskOverrides"]> = {},
) {
  const settings = task.runSettings;
  const mode = settings?.threadEnvMode;
  return {
    modelSelection:
      overrides.modelSelection ?? settings?.defaultModelSelection ?? fallback.modelSelection,
    runtimeMode: overrides.runtimeMode ?? settings?.runtimeMode ?? fallback.runtimeMode,
    interactionMode:
      overrides.interactionMode ?? settings?.interactionMode ?? fallback.interactionMode,
    workspaceStrategy:
      overrides.workspaceStrategy ??
      (mode === "local" && fallback.workspaceStrategy.type !== "root"
        ? { type: "root" as const }
        : mode === "worktree" && fallback.workspaceStrategy.type !== "worktree"
          ? { type: "worktree" as const, baseRef: "HEAD" }
          : fallback.workspaceStrategy),
  };
}
