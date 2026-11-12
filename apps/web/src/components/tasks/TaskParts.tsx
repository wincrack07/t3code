import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SavedPromptStatus } from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon, ServerIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  taskThreadState,
  type TaskEntry,
  type TaskThreadState,
} from "./tasks.logic";

/** The linked thread's shell, read without streaming ticks. */
export function useTaskThread(entry: TaskEntry) {
  const threadId = entry.task.latestThreadId;
  const shell = useQuietThreadShell(
    threadId ? scopeThreadRef(entry.home.environmentId, threadId) : null,
  );
  return { shell, state: taskThreadState(entry.task, shell) };
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
