import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  canMoveThreadToProject,
  threadProjectMoveRejection,
  threadProjectMoveRejectionMessage,
  threadProjectMoveUndo,
} from "@t3tools/client-runtime/state/thread-project-move";
import { newlyObservedProjectMove } from "@t3tools/client-runtime/state/thread-relationships";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "./components/ui/toast";
import { detachConfirmationMessage } from "./threadProjectMove.logic";
import { readLocalApi } from "./localApi";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProject, readThreadShell } from "./state/entities";
import { environmentThreadShells, threadEnvironment } from "./state/threads";
import { waitForAtomValue } from "./state/waitForAtomValue";

const SHELL_UPDATE_WAIT_MS = 5_000;

/** Moves this client requested, by thread and expected history index, so they toast once. */
const localMoves = new Map<string, Map<number, ProjectId>>();

function expectLocalMove(threadRef: ScopedThreadRef, index: number, projectId: ProjectId) {
  const key = scopedThreadKey(threadRef);
  const moves = localMoves.get(key) ?? new Map<number, ProjectId>();
  moves.set(index, projectId);
  localMoves.set(key, moves);
  return () => {
    moves.delete(index);
    if (moves.size === 0) localMoves.delete(key);
  };
}

function projectTitle(threadRef: ScopedThreadRef, projectId: ProjectId): string {
  return readProject(scopeProjectRef(threadRef.environmentId, projectId))?.title ?? "the project";
}

function failureToast(description: string) {
  toastManager.add(
    stackedThreadToast({ type: "error", title: "Could not move thread", description }),
  );
}

function runMove(threadRef: ScopedThreadRef, projectId: ProjectId, detachWorktree: boolean) {
  return runAtomCommand(
    appAtomRegistry,
    threadEnvironment.moveToProject,
    {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        projectId,
        ...(detachWorktree ? { detachWorktree: true } : {}),
      },
    },
    { reportFailure: false },
  );
}

/**
 * Moves a thread and reports the outcome where the user acted. A busy thread stores the move
 * and applies it when its turn ends; a worktree or branch thread asks before leaving it.
 */
export async function moveThreadToProject(
  threadRef: ScopedThreadRef,
  projectId: ProjectId,
  options: { readonly undo?: boolean } = {},
): Promise<void> {
  const before = readThreadShell(threadRef);
  if (before === null) return;
  const targetTitle = projectTitle(threadRef, projectId);
  // Registered before sending: the shell update can arrive before the reply.
  const forgetLocalMove = expectLocalMove(threadRef, before.projectMoves?.length ?? 0, projectId);
  let detachWorktree = false;
  let result = await runMove(threadRef, projectId, false);
  const rejection =
    result._tag === "Failure" ? threadProjectMoveRejection(squashAtomCommandFailure(result)) : null;
  if (rejection?.reason === "detach_required") {
    const api = readLocalApi();
    const confirmed = api
      ? await settlePromise(() =>
          api.dialogs.confirm(
            detachConfirmationMessage({
              threadTitle: before.title,
              targetTitle,
              inWorktree: before.worktreePath !== null,
              branch: before.branch,
              dirty: rejection.dirty,
            }),
          ),
        )
      : null;
    if (confirmed === null || confirmed._tag === "Failure" || !confirmed.value) {
      forgetLocalMove();
      return;
    }
    detachWorktree = true;
    result = await runMove(threadRef, projectId, true);
  }
  if (result._tag === "Failure") {
    forgetLocalMove();
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    const typed = threadProjectMoveRejection(error);
    failureToast(
      typed
        ? threadProjectMoveRejectionMessage(typed, targetTitle)
        : error instanceof Error
          ? error.message
          : "An error occurred.",
    );
    return;
  }
  // The reply lands before the shell stream, so wait to learn whether it moved or queued.
  let outcome: "moved" | "pending" | null = null;
  await waitForAtomValue({
    registry: appAtomRegistry,
    atom: environmentThreadShells.threadShellAtom(threadRef),
    predicate: (thread) => {
      if (thread?.projectId === projectId) outcome = "moved";
      else if (thread?.pendingProjectMove?.projectId === projectId) outcome = "pending";
      return outcome !== null;
    },
    timeoutMs: SHELL_UPDATE_WAIT_MS,
  });
  if (outcome === "pending") {
    // The move applies when the turn ends; the watcher announces it then.
    forgetLocalMove();
    toastManager.add({
      type: "info",
      title: `Moves to ${targetTitle} when this turn finishes`,
      description: before.title,
    });
    return;
  }
  if (outcome !== "moved") return;
  if (options.undo) {
    toastManager.add({ type: "success", title: `Moved back to ${targetTitle}` });
    return;
  }
  const move = readThreadShell(threadRef)?.projectMoves?.at(-1);
  if (move !== undefined)
    showProjectMoveToast(threadRef, move, {
      threadTitle: before.title,
      leftBranch: detachWorktree && before.worktreePath === null,
    });
}

/** "Moved to X" with Undo, for moves made here, applied later, or made by another client. */
function showProjectMoveToast(
  threadRef: ScopedThreadRef,
  move: NonNullable<EnvironmentThreadShell["projectMoves"]>[number],
  options: { readonly threadTitle: string; readonly leftBranch?: boolean },
) {
  const undo = threadProjectMoveUndo(
    { projectMoves: [move] },
    readProject(scopeProjectRef(threadRef.environmentId, move.previousProjectId))?.workspaceRoot ??
      null,
  );
  const left = undo?.leftWorktree ? "worktree" : options.leftBranch ? "branch" : null;
  const toastId = toastManager.add({
    type: "success",
    title: `Moved to ${projectTitle(threadRef, move.projectId)}`,
    description: left
      ? `Undo returns it to ${projectTitle(threadRef, move.previousProjectId)}, not to its ${left}.`
      : options.threadTitle,
    ...(undo === null
      ? {}
      : {
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(toastId);
              void moveThreadToProject(threadRef, undo.projectId, { undo: true });
            },
          },
        }),
  });
}

/**
 * Announces moves this client did not just make: a deferred move applying when its turn ends,
 * or a move from another client. Returns the unsubscribe.
 */
export function watchThreadProjectMoves(): () => void {
  let previousByKey = new Map<string, EnvironmentThreadShell>();
  const observe = (shells: ReadonlyArray<EnvironmentThreadShell>) => {
    const nextByKey = new Map<string, EnvironmentThreadShell>();
    for (const shell of shells) {
      const threadRef = scopeThreadRef(shell.environmentId, shell.id);
      const key = scopedThreadKey(threadRef);
      nextByKey.set(key, shell);
      const previous = previousByKey.get(key) ?? null;
      if (previous === null || previous.projectMoves === shell.projectMoves) continue;
      const local = localMoves.get(key);
      const move = newlyObservedProjectMove(previous, shell, local);
      // A local move is announced by its own flow; once seen it needs no suppression.
      local?.forEach((_, index) => {
        if (index < (shell.projectMoves?.length ?? 0)) local.delete(index);
      });
      if (local?.size === 0) localMoves.delete(key);
      if (move !== null) showProjectMoveToast(threadRef, move, { threadTitle: shell.title });
    }
    previousByKey = nextByKey;
  };
  observe(appAtomRegistry.get(environmentThreadShells.threadShellsAtom));
  return appAtomRegistry.subscribe(environmentThreadShells.threadShellsAtom, observe);
}

/** Moving to the current project withdraws a move that waits for the turn to finish. */
export async function cancelThreadProjectMove(threadRef: ScopedThreadRef): Promise<void> {
  const thread = readThreadShell(threadRef);
  if (thread?.pendingProjectMove == null) return;
  const result = await runMove(threadRef, thread.projectId, false);
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not cancel the move",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}

/** What a thread menu shows for moving; absent when the thread cannot move. */
export function threadProjectMoveMenuState(
  threadRef: ScopedThreadRef,
): { readonly pendingTargetTitle: string | null } | undefined {
  const thread = readThreadShell(threadRef);
  if (thread === null || !canMoveThreadToProject(thread)) return undefined;
  const pending = thread.pendingProjectMove;
  return { pendingTargetTitle: pending ? projectTitle(threadRef, pending.projectId) : null };
}
