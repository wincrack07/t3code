import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  buildProjectGroups,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProjectSavedPrompt,
  type ProjectTaskAttachment,
  repositoryGroupingKeyOf,
  type SavedPromptStatus,
  type ScopedThreadRef,
  taskAttachmentKey,
} from "@t3tools/contracts";
import { buildNewThreadLink, PROMPT_LINK_MAX_PROMPT_LENGTH } from "@t3tools/shared/promptLinks";

export const TASK_STATUSES = [
  "open",
  "in-progress",
  "done",
] as const satisfies ReadonlyArray<SavedPromptStatus>;
export const TASK_STATUS_LABELS: Record<SavedPromptStatus, string> = {
  open: "Open",
  "in-progress": "In progress",
  review: "Review",
  done: "Done",
};
export const TASK_TEXT_MAX_LENGTH = 120_000;
export const TASK_TITLE_MAX_LENGTH = 160;
/** The polish service refuses longer prompts. */
export const TASK_POLISH_MAX_LENGTH = 20_000;

const taskStatus = (task: ProjectSavedPrompt): SavedPromptStatus =>
  task.status === "review"
    ? "in-progress"
    : (task.status ?? (task.completedAt === null ? "open" : "done"));

export const taskTitle = (task: ProjectSavedPrompt) =>
  task.title ?? (task.text.split("\n")[0]?.slice(0, TASK_TITLE_MAX_LENGTH) || "Untitled task");

/** A task as the client shows it: the stored record plus the project copy on its home machine. */
export interface TaskEntry {
  readonly key: string;
  readonly task: ProjectSavedPrompt;
  readonly home: EnvironmentProject;
  readonly status: SavedPromptStatus;
  /** Position in its home project's task array, which is the manual order. */
  readonly order: number;
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

/**
 * Each machine keeps its own manual order (new tasks first). Merging those lists by their newer
 * head keeps every machine's order intact and reads newest-first until someone reorders.
 */
function mergeManualOrder<T>(items: ReadonlyArray<T>, entryOf: (item: T) => TaskEntry): T[] {
  const lists = new Map<string, T[]>();
  for (const item of items) {
    const { home } = entryOf(item);
    const key = `${home.environmentId}\u0000${home.id}`;
    lists.set(key, [...(lists.get(key) ?? []), item]);
  }
  const queues = [...lists.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, list]) => list.toSorted((left, right) => entryOf(left).order - entryOf(right).order));
  const merged: T[] = [];
  for (;;) {
    let best: T[] | null = null;
    for (const queue of queues) {
      if (queue.length === 0) continue;
      if (best === null || entryOf(queue[0]!).task.createdAt > entryOf(best[0]!).task.createdAt)
        best = queue;
    }
    if (best === null) return merged;
    merged.push(best.shift()!);
  }
}

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
          (project.savedPrompts ?? []).map((task, order) => ({
            key: taskKey(project.environmentId, project.id, task.id),
            task,
            home: project,
            status: taskStatus(task),
            order,
          })),
        );
      return {
        key: group.key,
        label: group.label,
        members,
        tasks: mergeManualOrder(tasks, (entry) => entry),
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

export const TASK_PRIORITIES = ["p1", "p2", "p3"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
};
export const taskPriority = (task: Pick<ProjectSavedPrompt, "priority">): TaskPriority =>
  task.priority ?? "p3";

export type TaskWhen = "today" | "later" | "none";
export const TASK_WHEN_LABELS: Record<TaskWhen, string> = {
  today: "Today",
  later: "Later",
  none: "Anytime",
};
export const taskWhen = (task: Pick<ProjectSavedPrompt, "when">): TaskWhen => task.when ?? "none";

export const TASK_TAG_MAX_COUNT = 12;
export const TASK_TAG_MAX_LENGTH = 32;

/** Tags as the server stores them: trimmed, lowercased, unique, within the limits. */
export function normalizeTaskTags(tags: ReadonlyArray<string>): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase().slice(0, TASK_TAG_MAX_LENGTH).trim())
        .filter(Boolean),
    ),
  ].slice(0, TASK_TAG_MAX_COUNT);
}

export interface TaskFilter {
  readonly query: string;
  readonly projectKey: string | null;
  readonly priority: TaskPriority | null;
  readonly tag: string | null;
  readonly environmentId: EnvironmentId | null;
}

export const NO_TASK_FILTER: TaskFilter = {
  query: "",
  projectKey: null,
  priority: null,
  tag: null,
  environmentId: null,
};

/** True when anything but the project narrows the list. */
const taskFilterActive = (filter: TaskFilter) =>
  filter.query.trim() !== "" ||
  filter.priority !== null ||
  filter.tag !== null ||
  filter.environmentId !== null;

function taskMatchesFilter(
  entry: TaskEntry,
  group: Pick<TaskProjectGroup, "key" | "label">,
  filter: TaskFilter,
): boolean {
  if (filter.projectKey !== null && group.key !== filter.projectKey) return false;
  if (filter.priority !== null && taskPriority(entry.task) !== filter.priority) return false;
  if (filter.tag !== null && !(entry.task.tags ?? []).includes(filter.tag)) return false;
  if (filter.environmentId !== null && entry.home.environmentId !== filter.environmentId)
    return false;
  const words = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [taskTitle(entry.task), entry.task.text, group.label, ...(entry.task.tags ?? [])]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Every tag in use, for the filter and the tag editor's suggestions. */
export const taskTagsInUse = (groups: ReadonlyArray<TaskProjectGroup>) =>
  [
    ...new Set(groups.flatMap((group) => group.tasks.flatMap((entry) => entry.task.tags ?? []))),
  ].toSorted();

export interface TaskRow {
  readonly entry: TaskEntry;
  readonly group: TaskProjectGroup;
  /** 1 for a subtask listed under its parent. */
  readonly depth: 0 | 1;
}

export type TaskListView = "inbox" | "project";

/** The capture field's project: the first preference that can store tasks, else the first one. */
export function taskCaptureProjectKey(
  storable: ReadonlyArray<Pick<TaskProjectGroup, "key">>,
  preferences: ReadonlyArray<string | null>,
): string | null {
  const keys = new Set(storable.map((group) => group.key));
  return preferences.find((key) => key !== null && keys.has(key)) ?? storable[0]?.key ?? null;
}

export interface TaskListSection {
  readonly id: string;
  readonly label: string;
  /** The `when` a drop into this section sets; null where order is per project only. */
  readonly when: TaskWhen | null;
  readonly group: TaskProjectGroup | null;
  readonly rows: ReadonlyArray<TaskRow>;
}

export interface TaskListModel {
  readonly sections: ReadonlyArray<TaskListSection>;
  readonly done: ReadonlyArray<TaskRow>;
  readonly openCount: number;
  readonly doneCount: number;
  readonly unreachable: number;
  /** Why nothing is listed: no tasks anywhere, or none that match the filter. */
  readonly empty: "none" | "filtered" | null;
}

const parentKey = (entry: TaskEntry) =>
  entry.task.parentTaskId
    ? taskKey(entry.home.environmentId, entry.home.id, entry.task.parentTaskId)
    : null;

type ListedTask = { readonly entry: TaskEntry; readonly group: TaskProjectGroup };

/**
 * Puts each subtask right under its parent when the parent is listed in the same set; a subtask
 * whose parent is filtered out or elsewhere stands on its own.
 */
function nestRows(entries: ReadonlyArray<ListedTask>) {
  const listed = new Set(entries.map(({ entry }) => entry.key));
  const children = new Map<string, TaskRow[]>();
  const top: ListedTask[] = [];
  for (const item of entries) {
    const parent = parentKey(item.entry);
    if (parent !== null && listed.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), { ...item, depth: 1 }]);
    } else top.push(item);
  }
  return {
    top,
    rows: (items: ReadonlyArray<ListedTask>): TaskRow[] =>
      items.flatMap((item) => [
        { ...item, depth: 0 as const },
        ...(children.get(item.entry.key) ?? []),
      ]),
  };
}

/**
 * The list views. Inbox groups open tasks by when (Today, Later, then the rest); By project
 * groups them by logical project. Both keep manual order and collapse done tasks into one list.
 */
export function buildTaskList(
  groups: ReadonlyArray<TaskProjectGroup>,
  filter: TaskFilter,
  view: TaskListView = "project",
): TaskListModel {
  const visibleGroups =
    filter.projectKey === null ? groups : groups.filter((group) => group.key === filter.projectKey);
  const matching = mergeManualOrder(
    visibleGroups.flatMap((group) =>
      group.tasks
        .filter((entry) => taskMatchesFilter(entry, group, filter))
        .map((entry) => ({ entry, group })),
    ),
    (item) => item.entry,
  );
  const open = nestRows(matching.filter(({ entry }) => entry.status !== "done"));
  const done = nestRows(matching.filter(({ entry }) => entry.status === "done"));
  const sections: TaskListSection[] =
    view === "inbox"
      ? (["today", "later", "none"] as const).map((when) => ({
          id: when,
          label: TASK_WHEN_LABELS[when],
          when,
          group: null,
          rows: open.rows(open.top.filter(({ entry }) => taskWhen(entry.task) === when)),
        }))
      : visibleGroups.flatMap((group) => {
          const rows = open.rows(open.top.filter((item) => item.group.key === group.key));
          return rows.length > 0
            ? [{ id: group.key, label: group.label, when: null, group, rows }]
            : [];
        });
  const openCount = matching.filter(({ entry }) => entry.status !== "done").length;
  const anyTasks = groups.some((group) => group.tasks.length > 0);
  return {
    sections,
    done: done.rows(done.top),
    openCount,
    doneCount: matching.length - openCount,
    // Unknown counts can't be attributed, so a machine counts once however many projects it holds.
    unreachable: new Set(
      visibleGroups.flatMap((group) =>
        group.members.filter((m) => !m.reachable).map((m) => m.project.environmentId),
      ),
    ).size,
    empty:
      matching.length > 0
        ? null
        : anyTasks && (filter.projectKey !== null || taskFilterActive(filter))
          ? "filtered"
          : "none",
  };
}

/** The keyboard order of a list: open sections, then done tasks when that list is expanded. */
export function taskListOrder(model: TaskListModel, doneExpanded: boolean): string[] {
  return [
    ...model.sections.flatMap((section) => section.rows),
    ...(doneExpanded ? model.done : []),
  ].map((row) => row.entry.key);
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

export interface TaskDropPlan {
  readonly entry: TaskEntry;
  readonly when: TaskWhen | null;
  /** The home project's ids in their new order; the server permutes them among their slots. */
  readonly reorder: ReadonlyArray<string> | null;
}

/**
 * What a row dropped in a section changes. Order is per home project and per parent, so a drop
 * beside a task from another machine or another parent only moves the task between sections.
 */
export function taskDropPlan(
  model: Pick<TaskListModel, "sections">,
  activeKey: string,
  target: { readonly sectionId: string; readonly overKey: string | null },
): TaskDropPlan | null {
  const rows = model.sections.flatMap((section) => section.rows);
  const active = rows.find((row) => row.entry.key === activeKey);
  const section = model.sections.find((candidate) => candidate.id === target.sectionId);
  if (!active || !section) return null;
  const from = model.sections.find((candidate) =>
    candidate.rows.some((row) => row.entry.key === activeKey),
  );
  const when =
    section.when !== null && active.depth === 0 && section.id !== from?.id ? section.when : null;
  const siblings = section.rows.filter(
    (row) =>
      row.entry.home.environmentId === active.entry.home.environmentId &&
      row.entry.home.id === active.entry.home.id &&
      (row.entry.task.parentTaskId ?? null) === (active.entry.task.parentTaskId ?? null) &&
      row.depth === active.depth,
  );
  const over = siblings.find((row) => row.entry.key === target.overKey);
  let reorder: string[] | null = null;
  if (over && over.entry.key !== activeKey) {
    const ids = siblings.map((row) => row.entry.task.id);
    const fromIndex = ids.indexOf(active.entry.task.id);
    const toIndex = ids.indexOf(over.entry.task.id);
    if (fromIndex === -1) ids.splice(toIndex, 0, active.entry.task.id);
    else {
      ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, active.entry.task.id);
    }
    reorder = ids;
  }
  if (when === null && reorder === null) return null;
  return { entry: active.entry, when, reorder };
}

export function buildTaskBoard(
  groups: ReadonlyArray<TaskProjectGroup>,
  filter: TaskFilter,
): Record<SavedPromptStatus, TaskRow[]> {
  const board: Record<SavedPromptStatus, TaskRow[]> = {
    open: [],
    "in-progress": [],
    review: [],
    done: [],
  };
  for (const group of groups) {
    for (const entry of group.tasks) {
      if (taskMatchesFilter(entry, group, filter))
        board[entry.status].push({ entry, group, depth: 0 });
    }
  }
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

/** Whole minutes a run has been going, at least 1; null when it has not started. */
export function taskRunningMinutes(startedAt: string | null, now: string): number | null {
  if (startedAt === null) return null;
  const elapsed = Date.parse(now) - Date.parse(startedAt);
  return Number.isFinite(elapsed) ? Math.max(1, Math.floor(elapsed / 60_000)) : null;
}

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

const TASK_ATTACHMENT_MAX_COUNT = 8;
const MIB = 1024 * 1024;
const TASK_IMAGE_MAX_BYTES = PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
const TASK_FILE_MAX_BYTES = PROVIDER_SEND_TURN_MAX_FILE_BYTES;

export interface TaskAttachmentCandidate {
  readonly name: string;
  readonly kind: "image" | "file" | "path";
  readonly sizeBytes: number;
}

/**
 * The server's task attachment limits, checked before anything is uploaded or copied. Its 80 MiB
 * image total can't be reached within eight images of 10 MiB.
 */
export function taskAttachmentLimitError(
  existing: ReadonlyArray<ProjectTaskAttachment>,
  incoming: ReadonlyArray<TaskAttachmentCandidate>,
): string | null {
  if (existing.length + incoming.length > TASK_ATTACHMENT_MAX_COUNT) {
    const room = Math.max(0, TASK_ATTACHMENT_MAX_COUNT - existing.length);
    return room === 0
      ? `A task holds up to ${TASK_ATTACHMENT_MAX_COUNT} attachments. Remove one to add another.`
      : `A task holds up to ${TASK_ATTACHMENT_MAX_COUNT} attachments. There is room for ${room} more.`;
  }
  for (const item of incoming) {
    if (item.kind === "image" && item.sizeBytes > TASK_IMAGE_MAX_BYTES)
      return `${item.name} is larger than the ${TASK_IMAGE_MAX_BYTES / MIB} MiB image limit.`;
    if (item.kind === "file" && item.sizeBytes > TASK_FILE_MAX_BYTES)
      return `${item.name} is larger than the ${TASK_FILE_MAX_BYTES / MIB} MiB file limit.`;
  }
  return null;
}

export type TaskReferenceState = "ok" | "missing" | "unavailable";

/** What `tasks.attachments` reports per attachment, reduced to what the strip reads. */
export interface InspectedTaskAttachment {
  readonly key: string;
  readonly missing: boolean;
  readonly sizeBytes: number;
  readonly isDirectory: boolean;
  readonly warning: string | null;
  readonly referenceStates: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly state: TaskReferenceState;
  }>;
}

export interface TaskAttachmentView {
  readonly key: string;
  readonly kind: "image" | "file" | "folder";
  readonly name: string;
  /** The full path of a reference, or where a stored copy lives. */
  readonly detail: string;
  readonly sizeBytes: number | null;
  /** Missing on the task's own machine. */
  readonly missing: boolean;
  readonly warning: string | null;
  readonly image: { readonly attachmentId: string; readonly mimeType: string } | null;
  /** A reference's state on each other machine that was checked. */
  readonly machines: ReadonlyArray<{ readonly label: string; readonly state: TaskReferenceState }>;
}

const basename = (path: string) =>
  path
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .at(-1) || path;

export function taskAttachmentViews(input: {
  readonly attachments: ReadonlyArray<ProjectTaskAttachment>;
  readonly inspected: ReadonlyArray<InspectedTaskAttachment> | null;
  readonly homeEnvironmentId: EnvironmentId;
  readonly labelOf: (environmentId: EnvironmentId) => string;
}): TaskAttachmentView[] {
  const byKey = new Map(input.inspected?.map((item) => [item.key, item]));
  return input.attachments.map((item): TaskAttachmentView => {
    const key = taskAttachmentKey(item);
    const inspected = byKey.get(key);
    if (item.kind === "stored") {
      const { attachment } = item;
      const image = attachment.type === "image";
      return {
        key,
        kind: image ? "image" : "file",
        name: "name" in attachment ? attachment.name : "Attachment",
        detail: `Stored copy on ${input.labelOf(input.homeEnvironmentId)}`,
        sizeBytes: "sizeBytes" in attachment ? attachment.sizeBytes : null,
        missing: inspected?.missing ?? false,
        warning: inspected?.warning ?? null,
        image: image ? { attachmentId: attachment.id, mimeType: attachment.mimeType } : null,
        machines: [],
      };
    }
    const directory = inspected?.isDirectory ?? item.isDirectory ?? false;
    return {
      key,
      kind: directory ? "folder" : "file",
      name: basename(item.path),
      detail: item.path,
      sizeBytes: directory ? null : (inspected?.sizeBytes ?? item.sizeBytes ?? null),
      missing: inspected?.missing ?? false,
      warning: inspected?.warning ?? null,
      image: null,
      machines: (inspected?.referenceStates ?? [])
        .filter((state) => state.environmentId !== input.homeEnvironmentId)
        .map((state) => ({ label: input.labelOf(state.environmentId), state: state.state })),
    };
  });
}

export interface TaskStartTarget {
  readonly project: EnvironmentProject;
  readonly home: boolean;
  readonly disabledReason: string | null;
}

/**
 * Where a task's thread can start: its own machine first, then every other machine with the
 * project. Stored copies live only on the task's machine, so other machines can't send them.
 */
export function taskStartTargets(
  group: Pick<TaskProjectGroup, "members">,
  entry: Pick<TaskEntry, "task" | "home">,
  labelOf: (environmentId: EnvironmentId) => string,
): TaskStartTarget[] {
  const homeId = entry.home.environmentId;
  const stored = (entry.task.attachments ?? []).some((item) => item.kind === "stored");
  const seen = new Set([homeId]);
  const others = group.members.filter(({ project }) => {
    if (seen.has(project.environmentId)) return false;
    seen.add(project.environmentId);
    return true;
  });
  const homeKey = entry.home.repositoryIdentity
    ? repositoryGroupingKeyOf(entry.home.repositoryIdentity)
    : null;
  return [
    { project: entry.home, home: true, disabledReason: null },
    ...others.map(({ project, reachable }) => ({
      project,
      home: false,
      disabledReason: !reachable
        ? "Not connected"
        : homeKey === null ||
            !project.repositoryIdentity ||
            repositoryGroupingKeyOf(project.repositoryIdentity) !== homeKey
          ? "Not the same repository"
          : stored
            ? `Has attachments stored on ${labelOf(homeId)}`
            : null,
    })),
  ];
}

/** The task's latest thread and the older ones it keeps, each on the machine that ran it. */
export function taskThreadRefs(
  task: Pick<ProjectSavedPrompt, "latestThreadId" | "latestThreadEnvironmentId" | "threadLinks">,
  homeEnvironmentId: EnvironmentId,
): { latest: ScopedThreadRef | null; previous: ScopedThreadRef[] } {
  const latest = task.latestThreadId
    ? scopeThreadRef(task.latestThreadEnvironmentId ?? homeEnvironmentId, task.latestThreadId)
    : null;
  const seen = new Set(latest ? [scopedThreadKey(latest)] : []);
  const previous = (task.threadLinks ?? []).flatMap((link) => {
    const ref = scopeThreadRef(link.environmentId ?? homeEnvironmentId, link.threadId);
    const key = scopedThreadKey(ref);
    if (seen.has(key)) return [];
    seen.add(key);
    return [ref];
  });
  return { latest, previous };
}

/** A start whose link failed, until the task records that thread by any route. */
export function pendingTaskLink<R extends { readonly thread: ScopedThreadRef }>(
  receipt: R | undefined,
  task: Pick<ProjectSavedPrompt, "latestThreadId" | "latestThreadEnvironmentId" | "threadLinks">,
  homeEnvironmentId: EnvironmentId,
): R | null {
  if (!receipt) return null;
  const { latest, previous } = taskThreadRefs(task, homeEnvironmentId);
  const key = scopedThreadKey(receipt.thread);
  return [latest, ...previous].some((ref) => ref !== null && scopedThreadKey(ref) === key)
    ? null
    : receipt;
}
