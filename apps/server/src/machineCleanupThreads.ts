import type { OrchestrationV2ThreadShell, ProjectId } from "@t3tools/contracts";
import { threadHasQueuedTurnStart } from "./orchestration-v2/ThreadSettlementService.ts";

type CleanupThreadRecord = Parameters<typeof threadHasQueuedTurnStart>[0] &
  Pick<
    OrchestrationV2ThreadShell,
    | "projectId"
    | "worktreePath"
    | "settledAt"
    | "settledOverride"
    | "activeRunId"
    | "pendingBackgroundTasks"
  >;

export function activeMachineCleanupPaths(
  threads: readonly CleanupThreadRecord[],
  now: number,
  projects: readonly { readonly id: ProjectId; readonly workspaceRoot: string }[] = [],
) {
  const roots = new Map(projects.map((project) => [project.id, project.workspaceRoot]));
  return threads.flatMap((thread) => {
    const target = thread.worktreePath ?? roots.get(thread.projectId) ?? null;
    return target !== null &&
      (thread.settledAt === null ||
        thread.settledOverride === "active" ||
        thread.activeRunId !== null ||
        threadHasQueuedTurnStart(thread, now) ||
        (thread.pendingBackgroundTasks?.length ?? 0) > 0)
      ? [target]
      : [];
  });
}
