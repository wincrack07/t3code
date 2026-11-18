import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "./i18n/messages";

import {
  projectFolderOfProject,
  projectFolderPath,
  projectFolderTree,
  type ProjectFolder,
} from "./projectFolders";

interface MoveTargetGroup {
  readonly projectKey: string;
  readonly isScratch?: boolean | undefined;
  readonly archived: boolean;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly memberProjects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
  }>;
}

export interface ThreadMoveTarget<G extends MoveTargetGroup = MoveTargetGroup> {
  readonly group: G;
  /** The project on the thread's own machine; null when the logical project has none there. */
  readonly project: G["memberProjects"][number] | null;
  readonly current: boolean;
  readonly disabledReason: string | null;
}

export interface ThreadMoveTargetSection<G extends MoveTargetGroup> {
  readonly id: string;
  readonly label: string;
  readonly targets: ReadonlyArray<ThreadMoveTarget<G>>;
}

/** Projects are per machine, so only a project on the thread's own machine can take it. */
export function resolveThreadMoveTarget<G extends MoveTargetGroup>(
  input: {
    readonly group: G;
    readonly thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
    readonly machineLabel: string;
  },
  resolve: MessageResolver = m,
): ThreadMoveTarget<G> {
  const project =
    input.group.memberProjects.find(
      (member) => member.environmentId === input.thread.environmentId,
    ) ?? null;
  const current = input.group.memberProjectRefs.some(
    (ref) =>
      ref.environmentId === input.thread.environmentId && ref.projectId === input.thread.projectId,
  );
  return {
    group: input.group,
    project,
    current,
    disabledReason: current
      ? resolve(msg("Current project"))
      : project === null
        ? resolve(msg("Not on {machine}", { machine: input.machineLabel }))
        : null,
  };
}

/**
 * The picker's sections in sidebar order: one per user group, then Ungrouped. `groups` arrive
 * sorted the way the sidebar sorts them, so pinned and recent projects lead each section.
 */
export function buildThreadMoveTargetSections<G extends MoveTargetGroup>(
  input: {
    readonly groups: ReadonlyArray<G>;
    readonly folders: ReadonlyArray<ProjectFolder>;
    readonly thread: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };
    readonly machineLabel: string;
  },
  resolve: MessageResolver = m,
): ReadonlyArray<ThreadMoveTargetSection<G>> {
  const byFolderId = new Map<string | null, ThreadMoveTarget<G>[]>();
  for (const group of input.groups) {
    if (group.isScratch || group.archived) continue;
    const folderId = projectFolderOfProject(input.folders, group.projectKey)?.id ?? null;
    const targets = byFolderId.get(folderId) ?? [];
    targets.push(
      resolveThreadMoveTarget(
        { group, thread: input.thread, machineLabel: input.machineLabel },
        resolve,
      ),
    );
    byFolderId.set(folderId, targets);
  }
  const sections: ThreadMoveTargetSection<G>[] = projectFolderTree(input.folders).flatMap(
    ({ folder }) => {
      const targets = byFolderId.get(folder.id);
      return targets
        ? [{ id: folder.id, label: projectFolderPath(input.folders, folder.id), targets }]
        : [];
    },
  );
  const ungrouped = byFolderId.get(null);
  if (ungrouped)
    sections.push({
      id: "ungrouped",
      label:
        sections.length > 0
          ? resolve(msg("Ungrouped", { $context: "section of projects outside any group" }))
          : resolve(msg("Projects")),
      targets: ungrouped,
    });
  return sections;
}

/** Plain words for what leaving a worktree or branch does; the server keeps both on disk. */
export function detachConfirmationMessage(input: {
  readonly threadTitle: string;
  readonly targetTitle: string;
  readonly inWorktree: boolean;
  readonly branch: string | null;
  readonly dirty: boolean | undefined;
}): string {
  const left = input.inWorktree
    ? m(
        msg(
          "The thread leaves its worktree and continues in the project folder. The worktree and its branch stay on disk.",
        ),
      )
    : input.branch
      ? m(
          msg(
            "The thread leaves branch {branch} and continues in the project folder. The branch stays on disk.",
            { branch: input.branch },
          ),
        )
      : m(
          msg(
            "The thread leaves its branch and continues in the project folder. The branch stays on disk.",
          ),
        );
  const dirty =
    input.dirty === true
      ? input.inWorktree
        ? m(msg("The worktree has uncommitted changes. They stay in the worktree."))
        : m(msg("The current folder has uncommitted changes. They stay there."))
      : null;
  const question = m(
    msg('Move "{threadTitle}" to {targetTitle}?', {
      threadTitle: input.threadTitle,
      targetTitle: input.targetTitle,
    }),
  );
  return [question, left, dirty].filter(Boolean).join("\n");
}
