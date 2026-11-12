import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  buildProjectGroups,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectSavedPrompt, SavedPromptStatus } from "@t3tools/contracts";
import { buildNewThreadLink, PROMPT_LINK_MAX_PROMPT_LENGTH } from "@t3tools/shared/promptLinks";

export const TASK_STATUSES = [
  "open",
  "in-progress",
  "done",
] as const satisfies ReadonlyArray<SavedPromptStatus>;
export const TASK_STATUS_LABELS: Record<SavedPromptStatus, string> = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
};
export const TASK_TEXT_MAX_LENGTH = 120_000;
export const TASK_TITLE_MAX_LENGTH = 160;
/** The polish service refuses longer prompts. */
export const TASK_POLISH_MAX_LENGTH = 20_000;

const taskStatus = (task: ProjectSavedPrompt): SavedPromptStatus =>
  task.status ?? (task.completedAt === null ? "open" : "done");

export const taskTitle = (task: ProjectSavedPrompt) =>
  task.title ?? (task.text.split("\n")[0]?.slice(0, TASK_TITLE_MAX_LENGTH) || "Untitled task");

/** A task as the client shows it: the stored record plus the project copy on its home machine. */
export interface TaskEntry {
  readonly key: string;
  readonly task: ProjectSavedPrompt;
  readonly home: EnvironmentProject;
  readonly status: SavedPromptStatus;
}

export interface TaskProjectMember {
  readonly project: EnvironmentProject;
  readonly reachable: boolean;
}

/** One logical project as the sidebar groups it, with the tasks of every reachable machine. */
export interface TaskProjectGroup {
  readonly key: string;
  readonly label: string;
  readonly members: ReadonlyArray<TaskProjectMember>;
  readonly tasks: ReadonlyArray<TaskEntry>;
  /** Machines that have this project but are not connected, so their tasks are unknown. */
  readonly unreachable: number;
  /** Tasks live on more than one machine, so rows name their machine. */
  readonly multiMachine: boolean;
}

export const taskKey = (environmentId: EnvironmentId, projectId: string, taskId: string) =>
  `${environmentId}:${projectId}:${taskId}`;

const byNewest = (left: TaskEntry, right: TaskEntry) =>
  right.task.createdAt.localeCompare(left.task.createdAt);

/**
 * Groups projects exactly as the sidebar does and unions their tasks. Tasks stay on the
 * machine that stores them; a disconnected machine's cached copy is left out, not shown stale.
 */
export function buildTaskProjectGroups(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly settings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connected: ReadonlySet<EnvironmentId>;
}): TaskProjectGroup[] {
  const byRef = new Map(
    input.projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
  const groups = buildProjectGroups({
    projects: input.projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
    groupScratchProjects: true,
  });
  return groups
    .map((group): TaskProjectGroup => {
      const members = group.memberProjectRefs.flatMap((ref) => {
        const project = byRef.get(scopedProjectKey(ref));
        return project ? [{ project, reachable: input.connected.has(project.environmentId) }] : [];
      });
      const tasks = members
        .filter((member) => member.reachable)
        .flatMap(({ project }) =>
          (project.savedPrompts ?? []).map((task) => ({
            key: taskKey(project.environmentId, project.id, task.id),
            task,
            home: project,
            status: taskStatus(task),
          })),
        )
        .toSorted(byNewest);
      return {
        key: group.key,
        label: group.label,
        members,
        tasks,
        unreachable: new Set(
          members.filter((member) => !member.reachable).map((m) => m.project.environmentId),
        ).size,
        multiMachine: new Set(tasks.map((entry) => entry.home.environmentId)).size > 1,
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function findTaskGroupForProject(
  groups: ReadonlyArray<TaskProjectGroup>,
  environmentId: EnvironmentId,
  projectId: string,
): TaskProjectGroup | null {
  return (
    groups.find((group) =>
      group.members.some(
        ({ project }) => project.environmentId === environmentId && project.id === projectId,
      ),
    ) ?? null
  );
}

export const openTaskCount = (group: Pick<TaskProjectGroup, "tasks">) =>
  group.tasks.filter((entry) => entry.status !== "done").length;

/**
 * Where a new task is stored when the composer has no settled machine (Auto balance) or the
 * Tasks page creates one: the primary machine when it has the project and is connected,
 * else the first connected machine by label. Only machines that store tasks qualify.
 */
export function pickTaskHomeProject(
  group: Pick<TaskProjectGroup, "members">,
  primaryEnvironmentId: EnvironmentId | null,
  labelOf: (environmentId: EnvironmentId) => string,
): EnvironmentProject | null {
  const candidates = group.members.filter(
    (member) => member.reachable && member.project.savedPrompts !== undefined,
  );
  return (
    candidates.find((member) => member.project.environmentId === primaryEnvironmentId)?.project ??
    candidates.toSorted((left, right) =>
      labelOf(left.project.environmentId).localeCompare(labelOf(right.project.environmentId)),
    )[0]?.project ??
    null
  );
}

export interface TaskListSection {
  readonly group: TaskProjectGroup;
  readonly tasks: ReadonlyArray<TaskEntry>;
}

export interface TaskListModel {
  readonly open: ReadonlyArray<TaskListSection>;
  readonly done: ReadonlyArray<TaskListSection>;
  readonly openCount: number;
  readonly doneCount: number;
  readonly unreachable: number;
  /** Why nothing is listed: no tasks anywhere, or none in the chosen project. */
  readonly empty: "none" | "filtered" | null;
}

export function buildTaskList(
  groups: ReadonlyArray<TaskProjectGroup>,
  projectKey: string | null,
): TaskListModel {
  const visible = projectKey === null ? groups : groups.filter((group) => group.key === projectKey);
  const sections = (keep: (entry: TaskEntry) => boolean) =>
    visible.flatMap((group) => {
      const tasks = group.tasks.filter(keep);
      return tasks.length > 0 ? [{ group, tasks }] : [];
    });
  const open = sections((entry) => entry.status !== "done");
  const done = sections((entry) => entry.status === "done");
  const count = (list: ReadonlyArray<TaskListSection>) =>
    list.reduce((total, section) => total + section.tasks.length, 0);
  const anyTasks = groups.some((group) => group.tasks.length > 0);
  const visibleTasks = count(open) + count(done);
  return {
    open,
    done,
    openCount: count(open),
    doneCount: count(done),
    // Unknown counts can't be attributed, so a machine counts once however many projects it holds.
    unreachable: new Set(
      visible.flatMap((group) =>
        group.members.filter((m) => !m.reachable).map((m) => m.project.environmentId),
      ),
    ).size,
    empty: visibleTasks > 0 ? null : anyTasks && projectKey !== null ? "filtered" : "none",
  };
}

/** The keyboard order of a list: open sections, then done ones when that group is expanded. */
export function taskListOrder(model: TaskListModel, doneExpanded: boolean): string[] {
  return [...model.open, ...(doneExpanded ? model.done : [])].flatMap((section) =>
    section.tasks.map((entry) => entry.key),
  );
}

export function adjacentTaskKey(
  order: ReadonlyArray<string>,
  current: string | null,
  direction: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index === -1) return direction === 1 ? order[0]! : order.at(-1)!;
  return order[Math.min(order.length - 1, Math.max(0, index + direction))]!;
}

export function buildTaskBoard(
  groups: ReadonlyArray<TaskProjectGroup>,
  projectKey: string | null,
): Record<SavedPromptStatus, TaskEntry[]> {
  const board: Record<SavedPromptStatus, TaskEntry[]> = { open: [], "in-progress": [], done: [] };
  for (const group of groups) {
    if (projectKey !== null && group.key !== projectKey) continue;
    for (const entry of group.tasks) board[entry.status].push(entry);
  }
  for (const status of TASK_STATUSES) board[status].sort(byNewest);
  return board;
}

/** A drop onto a column changes status only when the column differs. */
export function taskStatusForDrop(
  entry: Pick<TaskEntry, "status">,
  target: unknown,
): SavedPromptStatus | null {
  const status = TASK_STATUSES.find((candidate) => candidate === target);
  return status !== undefined && status !== entry.status ? status : null;
}

export type TaskThreadState = "running" | "finished" | "missing";

export function taskThreadState(
  task: Pick<ProjectSavedPrompt, "latestThreadId">,
  shell: Pick<EnvironmentThreadShell, "runtime"> | null,
): TaskThreadState | null {
  if (task.latestThreadId === undefined) return null;
  if (shell === null) return "missing";
  return threadRuntimeIsActive(shell.runtime) ? "running" : "finished";
}

/**
 * The `/new?prompt=` link for a task, or null when the prompt is longer than a link may carry:
 * the link parser refuses prompts above PROMPT_LINK_MAX_PROMPT_LENGTH characters.
 */
export function taskThreadLink(text: string, origin?: string): string | null {
  if (text.length > PROMPT_LINK_MAX_PROMPT_LENGTH) return null;
  return buildNewThreadLink({ prompt: text, ...(origin ? { origin } : {}) });
}
