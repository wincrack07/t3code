import { scopeProjectRef } from "@t3tools/client-runtime/environment";
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
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "./components/ui/toast";
import { detachConfirmationMessage } from "./threadProjectMove.logic";
import { readLocalApi } from "./localApi";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProject, readThreadShell } from "./state/entities";
import { environmentThreadShells, threadEnvironment } from "./state/threads";
import { waitForAtomValue } from "./state/waitForAtomValue";

const SHELL_UPDATE_WAIT_MS = 5_000;

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
  let detachWorktree = false;
  let result = await runMove(threadRef, projectId, false);
  const rejection =
    result._tag === "Failure" ? threadProjectMoveRejection(squashAtomCommandFailure(result)) : null;
  if (rejection?.reason === "detach_required") {
    const api = readLocalApi();
    if (!api) return;
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        detachConfirmationMessage({
          threadTitle: before.title,
          targetTitle,
          inWorktree: before.worktreePath !== null,
          branch: before.branch,
          dirty: rejection.dirty,
        }),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    detachWorktree = true;
    result = await runMove(threadRef, projectId, true);
  }
  if (result._tag === "Failure") {
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
  const moved = readThreadShell(threadRef);
  const undo =
    moved === null
      ? null
      : threadProjectMoveUndo(
          moved,
          readProject(scopeProjectRef(threadRef.environmentId, before.projectId))?.workspaceRoot ??
            null,
        );
  const left =
    undo?.leftWorktree || before.worktreePath !== null
      ? "worktree"
      : detachWorktree
        ? "branch"
        : null;
  const toastId = toastManager.add({
    type: "success",
    title: `Moved to ${targetTitle}`,
    description: left
      ? `Undo returns it to ${projectTitle(threadRef, before.projectId)}, not to its ${left}.`
      : before.title,
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
