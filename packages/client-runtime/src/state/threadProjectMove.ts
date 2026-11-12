import type {
  OrchestrationV2AppThread,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  ProjectId,
  RunId,
  ThreadProjectMoveRejectedError,
} from "@t3tools/contracts";

export type ThreadProjectMoveRejection = Pick<ThreadProjectMoveRejectedError, "reason" | "dirty">;

type MoveThread = Pick<
  OrchestrationV2AppThread,
  "projectId" | "worktreePath" | "projectMoves" | "pendingProjectMove" | "lineage"
>;

/** The typed reason the server gave for refusing a move, if the failure carries one. */
export function threadProjectMoveRejection(error: unknown): ThreadProjectMoveRejection | null {
  if (typeof error !== "object" || error === null || !("moveRejection" in error)) return null;
  const rejection = (error as { readonly moveRejection?: ThreadProjectMoveRejection })
    .moveRejection;
  return rejection?.reason === undefined ? null : rejection;
}

export function threadProjectMoveRejectionMessage(
  rejection: ThreadProjectMoveRejection,
  targetName: string,
): string {
  switch (rejection.reason) {
    case "target_not_local":
      return `${targetName} is not on this thread's machine.`;
    case "target_deleted":
      return `${targetName} was deleted.`;
    case "same_project":
      return `The thread is already in ${targetName}.`;
    case "thread_deleted":
      return "This thread was deleted.";
    case "child_thread":
      return "Subagents, forks, and side chats stay in the project of the thread they came from.";
    case "detach_required":
      return "The thread is in a worktree or on another branch.";
  }
}

/** Only top-level threads move; the server rejects subagents, forks, and side chats. */
export function canMoveThreadToProject(thread: Pick<MoveThread, "lineage">): boolean {
  return thread.lineage.relationshipToParent === null && thread.lineage.sideChat !== true;
}

/** Undo moves the thread back to where its latest move started. */
export function threadProjectMoveUndo(
  thread: Pick<MoveThread, "projectMoves">,
  previousProjectRoot: string | null,
): { readonly projectId: ProjectId; readonly leftWorktree: boolean } | null {
  const move = thread.projectMoves?.at(-1);
  if (move === undefined) return null;
  return {
    projectId: move.previousProjectId,
    // The server records the worktree as the previous cwd and never moves a thread back into it.
    leftWorktree: previousProjectRoot !== null && move.previousCwd !== previousProjectRoot,
  };
}

export interface PreviousProjectCheckpoints {
  readonly byTurnCount: ReadonlyMap<number, ProjectId>;
  readonly byRunId: ReadonlyMap<RunId, ProjectId>;
}

/** Shared by every thread that never moved, so its identity stays stable across renders. */
export const NO_PREVIOUS_PROJECT_CHECKPOINTS: PreviousProjectCheckpoints = {
  byTurnCount: new Map(),
  byRunId: new Map(),
};

/**
 * Turns whose checkpoints live in another project's folder, keyed by the turn count a revert
 * targets and by run, with the project they belong to. Mirrors the server's ownership rule.
 */
export function previousProjectCheckpoints(input: {
  readonly thread: Pick<MoveThread, "projectId" | "worktreePath" | "projectMoves">;
  readonly checkpointScopes: ReadonlyArray<
    Pick<OrchestrationV2CheckpointScope, "id" | "projectId" | "cwd">
  >;
  readonly checkpoints: ReadonlyArray<
    Pick<
      OrchestrationV2Checkpoint,
      "scopeId" | "runId" | "appRunOrdinal" | "ordinalWithinScope" | "status"
    >
  >;
}): PreviousProjectCheckpoints {
  const moves = input.thread.projectMoves ?? [];
  const lastMove = moves.at(-1);
  if (lastMove === undefined) return NO_PREVIOUS_PROJECT_CHECKPOINTS;
  const byTurnCount = new Map<number, ProjectId>();
  const byRunId = new Map<RunId, ProjectId>();
  const currentCwd = input.thread.worktreePath ?? lastMove.cwd;
  const ownerByScopeId = new Map<string, ProjectId>();
  for (const scope of input.checkpointScopes) {
    if (scope.projectId != null) {
      if (scope.projectId !== input.thread.projectId) ownerByScopeId.set(scope.id, scope.projectId);
      continue;
    }
    if (scope.cwd === currentCwd) continue;
    // Scopes from before ownership was recorded: the move that left this folder names its project.
    const owner =
      moves.findLast((move) => move.previousCwd === scope.cwd)?.previousProjectId ??
      lastMove.previousProjectId;
    ownerByScopeId.set(scope.id, owner);
  }
  for (const checkpoint of input.checkpoints) {
    const owner = ownerByScopeId.get(checkpoint.scopeId);
    if (owner !== undefined && checkpoint.runId !== null) byRunId.set(checkpoint.runId, owner);
    // A revert picks the last rewindable checkpoint for its turn count, so the last one decides.
    if (checkpoint.status !== "ready" && checkpoint.status !== "missing") continue;
    const turnCount =
      checkpoint.appRunOrdinal ?? (checkpoint.ordinalWithinScope === 0 ? 0 : undefined);
    if (turnCount === undefined) continue;
    if (owner === undefined) byTurnCount.delete(turnCount);
    else byTurnCount.set(turnCount, owner);
  }
  return { byTurnCount, byRunId };
}
