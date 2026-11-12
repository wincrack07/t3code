import type { SavedPromptStatus, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ServerIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  taskRunningMinutes,
  taskThreadRefs,
  taskThreadState,
  type TaskEntry,
  type TaskThreadState,
} from "./tasks.logic";

/** The latest linked thread's shell, on the machine that ran it, read without streaming ticks. */
export function useTaskThread(entry: TaskEntry) {
  const ref = taskThreadRefs(entry.task, entry.home.environmentId).latest;
  const shell = useQuietThreadShell(ref);
  return { ref, shell, state: taskThreadState(entry.task, shell) };
}

/** One linked thread: its status, title and machine; opens the thread. */
export function TaskThreadRow({
  threadRef,
  machineLabel,
}: {
  threadRef: ScopedThreadRef;
  machineLabel: string | null;
}) {
  const navigate = useNavigate();
  const shell = useQuietThreadShell(threadRef);
  const state = taskThreadState({ latestThreadId: threadRef.threadId }, shell);
  if (!shell) {
    return (
      <p className="flex h-8 min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
        <TaskThreadDot state="missing" />
        <span className="min-w-0 truncate">
          The linked thread is archived or not loaded
          {machineLabel ? ` on ${machineLabel}` : ""}.
        </span>
      </p>
    );
  }
  return (
    <button
      type="button"
      className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={() =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        })
      }
    >
      <TaskThreadDot state={state ?? "missing"} />
      <span className="min-w-0 flex-1 truncate">{shell.title}</span>
      {machineLabel ? (
        <span className="max-w-32 shrink truncate text-xs text-muted-foreground">
          {machineLabel}
        </span>
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground">
        {TASK_THREAD_STATE_LABELS[state ?? "missing"]}
      </span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export const TASK_THREAD_STATE_LABELS: Record<TaskThreadState, string> = {
  running: "Thread running",
  finished: "Thread finished",
  missing: "Thread unavailable",
};

/** Static status dot: blue while the linked thread runs, green once it finished. */
export function TaskThreadDot({
  state,
  className,
}: {
  state: TaskThreadState;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={TASK_THREAD_STATE_LABELS[state]}
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "running"
          ? "bg-info"
          : state === "finished"
            ? "bg-success"
            : "border border-muted-foreground/60",
        className,
      )}
    />
  );
}

const STATUS_BADGE = {
  open: "secondary",
  "in-progress": "info",
  review: "info",
  done: "success",
} as const satisfies Record<SavedPromptStatus, "secondary" | "info" | "success">;

/** A status chip that opens the status menu; the keyboard path for every status change. */
export function TaskStatusMenu({
  status,
  disabled,
  onChange,
}: {
  status: SavedPromptStatus;
  disabled: boolean;
  onChange: (status: SavedPromptStatus) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Badge
            variant={STATUS_BADGE[status]}
            size="control"
            render={<button type="button" aria-label={`Status: ${TASK_STATUS_LABELS[status]}`} />}
          />
        }
      >
        {TASK_STATUS_LABELS[status]}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        {TASK_STATUSES.map((value) => (
          <MenuItem key={value} onClick={() => value !== status && onChange(value)}>
            <CheckIcon className={value === status ? undefined : "invisible"} />
            {TASK_STATUS_LABELS[value]}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

export function TaskMachineChip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex min-w-0 shrink items-center gap-1 text-xs text-muted-foreground" />
        }
      >
        <ServerIcon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup>Stored on {label}</TooltipPopup>
    </Tooltip>
  );
}

/** "running · 4 min" for a task whose latest thread is working; repaints once a minute. */
export function TaskRunningLabel({ startedAt }: { startedAt: string | null }) {
  const now = useNowMinute();
  // The tick is a UTC minute without its zone (2026-11-12T17:32).
  const minutes = taskRunningMinutes(startedAt, `${now}:00Z`);
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
      <TaskThreadDot state="running" />
      {minutes === null ? "running" : `running · ${minutes} min`}
    </span>
  );
}
