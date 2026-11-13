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
  type TaskBatchEntry,
  type TaskReviewSnapshot,
} from "@t3tools/contracts";
import { buildNewThreadLink, PROMPT_LINK_MAX_PROMPT_LENGTH } from "@t3tools/shared/promptLinks";

export const TASK_STATUSES = [
  "open",
  "in-progress",
  "review",
  "done",
] as const satisfies ReadonlyArray<SavedPromptStatus>;
/** Statuses a person picks; Review is reached when a linked thread settles. */
export const TASK_MANUAL_STATUSES = [
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
  task.status ?? (task.completedAt === null ? "open" : "done");

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

/** Tasks whose result waits for someone to approve it or ask for changes. */
export const reviewTaskCount = (group: Pick<TaskProjectGroup, "tasks">) =>
  group.tasks.filter((entry) => entry.status === "review").length;

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

/**
 * A drop onto a column changes status only when the column differs. Review only fills from a
 * settled thread, so it takes no drops; a review card dropped on Done is an approval.
 */
export function taskStatusForDrop(
  entry: Pick<TaskEntry, "status">,
  target: unknown,
): SavedPromptStatus | "approve" | null {
  const status = TASK_MANUAL_STATUSES.find((candidate) => candidate === target);
  if (status === undefined || status === entry.status) return null;
  return entry.status === "review" && status === "done" ? "approve" : status;
}

export type TaskReviewTone = "success" | "warning" | "error" | "quiet";

export interface TaskReviewView {
  readonly outcome: string;
  readonly tone: TaskReviewTone;
  /** The final assistant message as plain text, for a short preview. */
  readonly excerpt: string | null;
  readonly changes: { readonly files: number; readonly label: string } | null;
  readonly duration: string | null;
  readonly pullRequests: TaskReviewSnapshot["pullRequests"];
}

const REVIEW_OUTCOMES: Record<
  TaskReviewSnapshot["outcome"],
  { readonly label: string; readonly tone: TaskReviewTone }
> = {
  completed: { label: "Finished", tone: "success" },
  "waiting for input": { label: "Finished with questions", tone: "warning" },
  failed: { label: "Failed", tone: "error" },
  interrupted: { label: "Interrupted", tone: "quiet" },
};

/** Markdown reduced to the words a two-line preview can show. */
function plainTextExcerpt(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTaskDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

export function taskReviewView(snapshot: TaskReviewSnapshot): TaskReviewView {
  const outcome = REVIEW_OUTCOMES[snapshot.outcome];
  const excerpt = snapshot.assistantMessage ? plainTextExcerpt(snapshot.assistantMessage) : "";
  return {
    outcome: outcome.label,
    tone: outcome.tone,
    excerpt: excerpt || null,
    changes:
      snapshot.changes && snapshot.changes.count > 0
        ? {
            files: snapshot.changes.count,
            label: `+${snapshot.changes.additions} \u2212${snapshot.changes.deletions}`,
          }
        : null,
    duration: snapshot.durationMs === undefined ? null : formatTaskDuration(snapshot.durationMs),
    pullRequests: snapshot.pullRequests,
  };
}

/**
 * The thread a task's home can't see settle on its own: it ran on another machine, so the
 * client reports its result once that thread is loaded and idle.
 */
export function taskReviewToReconcile(
  entry: Pick<TaskEntry, "task" | "home" | "status">,
  threadState: TaskThreadState | null,
): ScopedThreadRef | null {
  const { task } = entry;
  if (entry.status !== "in-progress" || threadState !== "finished") return null;
  if (!task.latestThreadId || !task.latestThreadEnvironmentId) return null;
  if (task.latestThreadEnvironmentId === entry.home.environmentId) return null;
  return scopeThreadRef(task.latestThreadEnvironmentId, task.latestThreadId);
}

export type TaskThreadState = "running" | "finished" | "missing";

/** Whole minutes a run has been going; null before its first full minute or its start. */
export function taskRunningMinutes(startedAt: string | null, now: string): number | null {
  if (startedAt === null) return null;
  const minutes = Math.floor((Date.parse(now) - Date.parse(startedAt)) / 60_000);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : null;
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

export const TASK_CRITERIA_MAX_COUNT = 20;
export const TASK_CRITERION_MAX_LENGTH = 500;

export type TaskCriterion = NonNullable<ProjectSavedPrompt["acceptanceCriteria"]>[number];

export type TaskCriteriaEdit =
  | { readonly kind: "add"; readonly text: string }
  | { readonly kind: "edit"; readonly index: number; readonly text: string }
  | { readonly kind: "toggle"; readonly index: number }
  | { readonly kind: "move"; readonly from: number; readonly to: number }
  | { readonly kind: "remove"; readonly index: number };

/**
 * The checklist after one edit, within the server's limits, or null when nothing changes.
 * Clearing an item's text removes it, since the server keeps no empty criteria.
 */
export function editTaskCriteria(
  criteria: ReadonlyArray<TaskCriterion>,
  edit: TaskCriteriaEdit,
): TaskCriterion[] | null {
  const list = [...criteria];
  const clean = (text: string) =>
    text.replace(/\s+/g, " ").trim().slice(0, TASK_CRITERION_MAX_LENGTH).trim();
  const inRange = (index: number) => index >= 0 && index < list.length;
  switch (edit.kind) {
    case "add": {
      const text = clean(edit.text);
      if (!text || list.length >= TASK_CRITERIA_MAX_COUNT) return null;
      return [...list, { text, done: false }];
    }
    case "edit": {
      if (!inRange(edit.index)) return null;
      const text = clean(edit.text);
      if (!text) return list.filter((_, index) => index !== edit.index);
      if (text === list[edit.index]!.text) return null;
      list[edit.index] = { ...list[edit.index]!, text };
      return list;
    }
    case "toggle":
      if (!inRange(edit.index)) return null;
      list[edit.index] = { ...list[edit.index]!, done: !list[edit.index]!.done };
      return list;
    case "move": {
      const to = Math.max(0, Math.min(list.length - 1, edit.to));
      if (!inRange(edit.from) || to === edit.from) return null;
      const [item] = list.splice(edit.from, 1);
      list.splice(to, 0, item!);
      return list;
    }
    case "remove":
      return inRange(edit.index) ? list.filter((_, index) => index !== edit.index) : null;
  }
}

/** A parent's subtasks on its own machine, in manual order. */
export function taskSubtasks(
  group: Pick<TaskProjectGroup, "tasks">,
  parent: Pick<TaskEntry, "task" | "home">,
): TaskEntry[] {
  return group.tasks.filter(
    (entry) =>
      entry.task.parentTaskId === parent.task.id &&
      entry.home.environmentId === parent.home.environmentId &&
      entry.home.id === parent.home.id,
  );
}

export function taskSubtaskCounts(subtasks: ReadonlyArray<Pick<TaskEntry, "status">>) {
  return {
    total: subtasks.length,
    done: subtasks.filter((entry) => entry.status === "done").length,
  };
}

export interface TaskAttempt {
  readonly key: string;
  readonly thread: ScopedThreadRef;
  /** The attempt ran on another machine than the task's. */
  readonly remote: boolean;
  readonly review: TaskReviewView | null;
  readonly finishedAt: string | null;
}

/** Every recorded attempt, newest first: each start and each requested change is one. */
export function taskAttempts(
  task: Pick<ProjectSavedPrompt, "threadLinks">,
  homeEnvironmentId: EnvironmentId,
): TaskAttempt[] {
  return (task.threadLinks ?? []).map((link, index) => {
    const environmentId = link.environmentId ?? homeEnvironmentId;
    return {
      key: `${environmentId}:${link.threadId}:${link.userMessageId ?? index}`,
      thread: scopeThreadRef(environmentId, link.threadId),
      remote: environmentId !== homeEnvironmentId,
      review: link.snapshot ? taskReviewView(link.snapshot) : null,
      finishedAt: link.snapshot?.finishedAt ?? null,
    };
  });
}

/** Where the task resolves a project's defaults: its preferred machine, else its own. */
export function taskRunProject(
  entry: Pick<TaskEntry, "task" | "home">,
  group: Pick<TaskProjectGroup, "members">,
): EnvironmentProject {
  const preferred = entry.task.runSettings?.targetEnvironmentId;
  return (
    group.members.find((member) => member.reachable && member.project.environmentId === preferred)
      ?.project ?? entry.home
  );
}

/**
 * The selection after a click: a plain toggle, or with Shift every task between the last
 * clicked one and this one, in the order the view lists them.
 */
export function nextTaskSelection(
  current: ReadonlySet<string>,
  order: ReadonlyArray<string>,
  key: string,
  anchor: string | null,
  range: boolean,
): Set<string> {
  const next = new Set(current);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(key);
  if (range && from !== -1 && to !== -1) {
    for (const item of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(item);
    return next;
  }
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export const TASK_BATCH_MAX_CONCURRENCY = 4;
export const TASK_BATCH_DEFAULT_CONCURRENCY = 2;

export interface TaskBatchPlanGroup {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly projectId: string;
    readonly concurrency?: number | undefined;
    readonly entries: ReadonlyArray<{
      readonly source: { readonly environmentId: EnvironmentId; readonly taskId: string };
    }>;
  };
}

export interface TaskBatchSummaryRow {
  readonly environmentId: EnvironmentId;
  readonly machine: string;
  readonly tasks: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    /** Why this task runs on its own machine whatever was chosen. */
    readonly pinned: string | null;
  }>;
}

/** Where each prepared task runs, grouped by machine, naming tasks held to their home. */
export function taskBatchSummary(
  groups: ReadonlyArray<TaskBatchPlanGroup>,
  entries: ReadonlyArray<TaskEntry>,
  choice: { readonly distribute: boolean; readonly environmentId: EnvironmentId | null },
  labelOf: (environmentId: EnvironmentId) => string,
): TaskBatchSummaryRow[] {
  const byTask = new Map(
    entries.map((entry) => [`${entry.home.environmentId}:${entry.task.id}`, entry] as const),
  );
  const rows = new Map<EnvironmentId, TaskBatchSummaryRow["tasks"][number][]>();
  for (const group of groups) {
    for (const item of group.input.entries) {
      const entry = byTask.get(`${item.source.environmentId}:${item.source.taskId}`);
      if (!entry) continue;
      const stored = (entry.task.attachments ?? []).some((a) => a.kind === "stored");
      const movedAway =
        choice.distribute ||
        (choice.environmentId !== null && choice.environmentId !== entry.home.environmentId);
      rows.set(group.environmentId, [
        ...(rows.get(group.environmentId) ?? []),
        {
          key: entry.key,
          title: taskTitle(entry.task),
          pinned:
            stored && movedAway && group.environmentId === entry.home.environmentId
              ? `Has attachments stored on ${labelOf(entry.home.environmentId)}`
              : null,
        },
      ]);
    }
  }
  return [...rows.entries()]
    .map(([environmentId, tasks]) => ({ environmentId, machine: labelOf(environmentId), tasks }))
    .toSorted((left, right) => left.machine.localeCompare(right.machine));
}

export type TaskQueueState = TaskBatchEntry["state"];

export interface TaskQueueView {
  readonly state: TaskQueueState;
  readonly position: number | null;
  readonly reason: string | null;
  readonly target: { readonly environmentId: EnvironmentId; readonly projectId: string };
  readonly batchId: string;
  readonly entryId: string;
}

/**
 * A task's place in the newest batch that holds it, while that place still matters: settled
 * and cancelled entries hand over to the task's own status.
 */
export function taskQueueView(
  items: ReadonlyArray<{
    readonly target: { readonly environmentId: EnvironmentId; readonly projectId: string };
    readonly batchId: string;
    readonly createdAt: string;
    readonly entry: Pick<TaskBatchEntry, "id" | "state" | "reason">;
    readonly position: number | null;
  }>,
): TaskQueueView | null {
  const latest = items
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
  if (!latest || latest.entry.state === "settled" || latest.entry.state === "cancelled")
    return null;
  return {
    state: latest.entry.state,
    position: latest.position,
    reason: latest.entry.reason ?? null,
    target: latest.target,
    batchId: latest.batchId,
    entryId: latest.entry.id,
  };
}

export interface TaskQueueTotals {
  readonly queued: number;
  readonly starting: number;
  readonly running: number;
  readonly failed: number;
  /** Batches that still hold queued entries, to cancel by machine. */
  readonly cancellable: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: string;
    readonly batchId: string;
  }>;
}

/** Every batch a loaded project holds, summed for the queue bar. */
export function taskQueueTotals(projects: ReadonlyArray<EnvironmentProject>): TaskQueueTotals {
  const count = (state: TaskQueueState) =>
    projects.reduce(
      (total, project) =>
        total +
        (project.taskBatches ?? [])
          .flatMap((batch) => batch.entries)
          .filter((entry) => entry.state === state).length,
      0,
    );
  return {
    queued: count("queued"),
    starting: count("starting"),
    running: count("running"),
    failed: count("failed-to-start"),
    cancellable: projects.flatMap((project) =>
      (project.taskBatches ?? [])
        .filter((batch) => batch.entries.some((entry) => entry.state === "queued"))
        .map((batch) => ({
          environmentId: project.environmentId,
          projectId: project.id,
          batchId: batch.id,
        })),
    ),
  };
}

/** The task's entries in every batch its project's machines hold, with queue positions. */
export function taskQueueItems(
  entry: Pick<TaskEntry, "task" | "home">,
  projects: ReadonlyArray<EnvironmentProject>,
) {
  const all = projects
    .flatMap((project) =>
      (project.taskBatches ?? []).flatMap((batch) =>
        batch.entries.map((item) => ({
          target: { environmentId: project.environmentId, projectId: project.id as string },
          batchId: batch.id as string,
          createdAt: batch.createdAt,
          entry: item,
        })),
      ),
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  return all
    .filter(
      (item) =>
        item.entry.source.environmentId === entry.home.environmentId &&
        item.entry.source.projectId === entry.home.id &&
        item.entry.source.taskId === entry.task.id,
    )
    .map((item) => ({
      ...item,
      position:
        item.entry.state !== "queued"
          ? null
          : all
              .filter(
                (other) =>
                  other.target.environmentId === item.target.environmentId &&
                  other.entry.state === "queued",
              )
              .indexOf(item) + 1,
    }));
}
