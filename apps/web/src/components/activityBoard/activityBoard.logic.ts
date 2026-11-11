import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import type { EnvironmentConnectionSummary } from "@t3tools/client-runtime/state/presentation";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import {
  isListedThreadLineage,
  type HostResourcesSnapshot,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

export type ThreadActivityState =
  | "approval"
  | "input"
  | "request"
  | "working"
  | "starting"
  | "waiting"
  | "background"
  | "subagents";

export interface ThreadActivity {
  readonly state: ThreadActivityState;
  readonly label: string;
  /** When the thread entered this state, when known. */
  readonly since: string | null;
}

export interface ActivityBoardThread extends ThreadActivity {
  readonly thread: EnvironmentThreadShell;
}

export interface ActivityBoardCard extends ActivityBoardThread {
  readonly subagents: ReadonlyArray<ActivityBoardThread>;
}

export interface ActivityBoardProjectGroup {
  readonly key: string;
  readonly project: EnvironmentProject | null;
  readonly cards: ReadonlyArray<ActivityBoardCard>;
}

export interface ActivityBoardColumn {
  readonly environment: EnvironmentConnectionSummary;
  readonly connected: boolean;
  readonly cardCount: number;
  readonly groups: ReadonlyArray<ActivityBoardProjectGroup>;
}

const STATE_ORDER: Record<ThreadActivityState, number> = {
  approval: 0,
  input: 1,
  request: 2,
  working: 3,
  starting: 4,
  waiting: 5,
  subagents: 6,
  background: 7,
};

/** What a thread is doing that keeps it on the board, or null when it is at rest. */
function resolveThreadActivity(thread: EnvironmentThreadShell): ThreadActivity | null {
  const tasks = thread.pendingBackgroundTasks;
  const settledAt = thread.latestRun?.completedAt ?? null;
  switch (resolveSidebarThreadStatus(thread)) {
    case "approval":
      return {
        state: "approval",
        label: thread.hasPendingApprovals ? "Needs approval" : "Subagent needs approval",
        since: pendingRequestAt(thread),
      };
    case "input":
      return {
        state: "input",
        label: thread.hasPendingUserInput ? "Waiting for your answer" : "Subagent has a question",
        since: thread.pendingUserInputAt ?? pendingRequestAt(thread),
      };
    case "request":
      return { state: "request", label: "Guest request", since: null };
    case "preparing":
      return { state: "starting", label: "Starting", since: resolveThreadWorkingStartedAt(thread) };
    case "working":
      return { state: "working", label: "Working", since: resolveThreadWorkingStartedAt(thread) };
    case "waiting":
      return {
        state: "waiting",
        label: presentPendingBackgroundWork(tasks)?.title ?? "Waiting on other threads",
        since: settledAt ?? resolveThreadWorkingStartedAt(thread),
      };
    case "failed":
    case "limited":
    case "ready": {
      const background = presentPendingBackgroundWork(tasks);
      return background === null
        ? null
        : { state: "background", label: background.title, since: settledAt };
    }
  }
}

function pendingRequestAt(thread: EnvironmentThreadShell): string | null {
  const request = thread.source.pendingRuntimeRequest;
  return request === null ? null : DateTime.formatIso(request.createdAt);
}

function compareActivity(left: ActivityBoardThread, right: ActivityBoardThread): number {
  const byState = STATE_ORDER[left.state] - STATE_ORDER[right.state];
  if (byState !== 0) return byState;
  // Longest-running first; unknown start times sort last.
  const leftSince = left.since === null ? Number.POSITIVE_INFINITY : Date.parse(left.since);
  const rightSince = right.since === null ? Number.POSITIVE_INFINITY : Date.parse(right.since);
  if (leftSince !== rightSince) return leftSince < rightSince ? -1 : 1;
  return left.thread.title.localeCompare(right.thread.title);
}

/**
 * The nearest thread with its own list row, so a subagent of a subagent nests
 * under the thread the user opened. A broken chain resolves to null.
 */
function resolveListedAncestor(
  thread: EnvironmentThreadShell,
  byId: ReadonlyMap<ThreadId, EnvironmentThreadShell>,
): EnvironmentThreadShell | null {
  const visited = new Set<ThreadId>();
  let current: EnvironmentThreadShell | undefined = thread;
  while (current !== undefined && !isListedThreadLineage(current.lineage)) {
    if (current.lineage.parentThreadId === null || visited.has(current.id)) return null;
    visited.add(current.id);
    current = byId.get(current.lineage.parentThreadId);
  }
  return current ?? null;
}

function buildColumnGroups(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  projectByKey: ReadonlyMap<string, EnvironmentProject>,
): ReadonlyArray<ActivityBoardProjectGroup> {
  const live = threads.filter((thread) => thread.archivedAt === null && thread.deletedAt === null);
  const byId = new Map(live.map((thread) => [thread.id, thread] as const));
  const childrenByParent = new Map<ThreadId, Array<EnvironmentThreadShell>>();
  for (const thread of live) {
    if (isListedThreadLineage(thread.lineage)) continue;
    const parent = resolveListedAncestor(thread, byId);
    if (parent === null) continue;
    const siblings = childrenByParent.get(parent.id);
    if (siblings) siblings.push(thread);
    else childrenByParent.set(parent.id, [thread]);
  }

  const cardsByProject = new Map<string, Array<ActivityBoardCard>>();
  for (const thread of live) {
    if (!isListedThreadLineage(thread.lineage)) continue;
    // Provider subagents never get runs of their own; the parent's roster says they are alive.
    const rosterChildIds = new Set(
      thread.pendingBackgroundTasks.flatMap((task) =>
        task.kind === "subagent" && task.childThreadId !== undefined ? [task.childThreadId] : [],
      ),
    );
    const subagents = (childrenByParent.get(thread.id) ?? [])
      .flatMap((child): Array<ActivityBoardThread> => {
        const activity =
          resolveThreadActivity(child) ??
          (rosterChildIds.has(child.id)
            ? { state: "working", label: "Working", since: null }
            : null);
        return activity === null ? [] : [{ thread: child, ...activity }];
      })
      .sort(compareActivity);
    const activity =
      resolveThreadActivity(thread) ??
      (subagents.length > 0
        ? { state: "subagents" as const, label: "Subagents running", since: null }
        : null);
    if (activity === null) continue;
    const projectKey = `${thread.environmentId}:${thread.projectId}`;
    const card: ActivityBoardCard = { thread, ...activity, subagents };
    const cards = cardsByProject.get(projectKey);
    if (cards) cards.push(card);
    else cardsByProject.set(projectKey, [card]);
  }

  return [...cardsByProject]
    .map(([key, cards]) => ({
      key,
      project: projectByKey.get(key) ?? null,
      cards: cards.sort(compareActivity),
    }))
    .sort(
      (left, right) =>
        STATE_ORDER[left.cards[0]!.state] - STATE_ORDER[right.cards[0]!.state] ||
        (left.project?.title ?? "").localeCompare(right.project?.title ?? ""),
    );
}

/**
 * One column per enabled environment, in catalog order. A column that is not
 * connected lists nothing: its last shells may be stale, and showing them as
 * running would mislead.
 */
export function buildActivityBoard(input: {
  readonly environments: ReadonlyArray<EnvironmentConnectionSummary>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}): ReadonlyArray<ActivityBoardColumn> {
  const projectByKey = new Map(
    input.projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const threadsByEnvironment = new Map<string, Array<EnvironmentThreadShell>>();
  for (const thread of input.threads) {
    const threads = threadsByEnvironment.get(thread.environmentId);
    if (threads) threads.push(thread);
    else threadsByEnvironment.set(thread.environmentId, [thread]);
  }
  return input.environments
    .filter((environment) => environment.isEnabled)
    .map((environment) => {
      const connected = environment.connectionState === "connected";
      const groups = connected
        ? buildColumnGroups(threadsByEnvironment.get(environment.environmentId) ?? [], projectByKey)
        : [];
      return {
        environment,
        connected,
        cardCount: groups.reduce((count, group) => count + group.cards.length, 0),
        groups,
      };
    });
}

export type HostCapacityLevel = "ok" | "busy" | "strained";

export interface HostCapacity {
  readonly level: HostCapacityLevel;
  /** 0 to 1, or null when the host could not measure it. */
  readonly cpu: number | null;
  readonly cpuCount: number;
  /** 0 to 1. */
  readonly memoryUsed: number;
  readonly usedMemoryBytes: number;
  readonly totalMemoryBytes: number;
}

// Matches chooseLoadBalancedEnvironment, which skips hosts past these limits.
const STRAINED_CPU = 0.95;
const STRAINED_MEMORY_USED = 0.95;
const BUSY_CPU = 0.75;
const BUSY_MEMORY_USED = 0.85;

export function presentHostCapacity(resources: HostResourcesSnapshot): HostCapacity | null {
  if (resources.totalMemoryBytes <= 0) return null;
  const usedMemoryBytes = Math.max(0, resources.totalMemoryBytes - resources.availableMemoryBytes);
  const memoryUsed = Math.min(1, usedMemoryBytes / resources.totalMemoryBytes);
  const cpu = resources.cpuUtilization;
  const level: HostCapacityLevel =
    (cpu ?? 0) >= STRAINED_CPU || memoryUsed >= STRAINED_MEMORY_USED
      ? "strained"
      : (cpu ?? 0) >= BUSY_CPU || memoryUsed >= BUSY_MEMORY_USED
        ? "busy"
        : "ok";
  return {
    level,
    cpu,
    cpuCount: resources.cpuCount,
    memoryUsed,
    usedMemoryBytes,
    totalMemoryBytes: resources.totalMemoryBytes,
  };
}
