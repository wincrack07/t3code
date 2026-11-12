import { ChevronRightIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskAttachmentCount } from "./TaskAttachments";
import { TaskMachineChip, TaskThreadDot, useTaskThread } from "./TaskParts";
import {
  adjacentTaskKey,
  taskListOrder,
  taskTitle,
  type TaskEntry,
  type TaskListModel,
  type TaskListSection,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

export function TaskList({
  model,
  selectedKey,
  onSelect,
  onOpen,
  showProjectCaptions,
  empty,
}: {
  model: TaskListModel;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  showProjectCaptions: boolean;
  empty: ReactNode;
}) {
  const [doneExpanded, setDoneExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const order = taskListOrder(model, doneExpanded);
  const focusKey = selectedKey !== null && order.includes(selectedKey) ? selectedKey : order[0];
  const focusRow = (key: string) =>
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-task-key="${CSS.escape(key)}"] [data-task-title]`)
      ?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-task-key]")?.dataset
      .taskKey;
    if (current === undefined) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = adjacentTaskKey(order, current, event.key === "ArrowDown" ? 1 : -1);
      if (next !== null) {
        onSelect(next);
        focusRow(next);
      }
    } else if (event.key === "Enter" && event.target instanceof HTMLButtonElement) {
      event.preventDefault();
      onOpen(current);
    }
  };

  if (model.empty !== null) return <div className="flex min-h-0 flex-1 flex-col">{empty}</div>;
  const renderSection = (section: TaskListSection) => (
    <section key={section.group.key} aria-label={section.group.label} className="flex flex-col">
      {showProjectCaptions ? (
        <h3 className="flex h-8 min-w-0 items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <span className="truncate">{section.group.label}</span>
          <span className="shrink-0 tabular-nums">· {section.tasks.length}</span>
        </h3>
      ) : null}
      {section.tasks.map((entry) => (
        <TaskRow
          key={entry.key}
          entry={entry}
          selected={entry.key === selectedKey}
          focusable={entry.key === focusKey}
          showMachine={section.group.multiMachine}
          onSelect={() => onSelect(entry.key)}
        />
      ))}
    </section>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        role="list"
        aria-label="Tasks"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
        onKeyDown={onKeyDown}
      >
        {model.open.map(renderSection)}
        {model.openCount === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">Nothing open. Nice.</p>
        ) : null}
        {model.doneCount > 0 ? (
          <div className="mt-1 flex flex-col">
            <button
              type="button"
              aria-expanded={doneExpanded}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => setDoneExpanded(!doneExpanded)}
            >
              <ChevronRightIcon className={cn("size-3.5 shrink-0", doneExpanded && "rotate-90")} />
              Done <span className="tabular-nums">· {model.doneCount}</span>
            </button>
            {doneExpanded ? model.done.map(renderSection) : null}
          </div>
        ) : null}
      </div>
      <TaskListFooter unreachable={model.unreachable} />
    </div>
  );
}

function TaskListFooter({ unreachable }: { unreachable: number }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground">
      {unreachable > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 truncate" />}>
            {unreachable} {unreachable === 1 ? "machine" : "machines"} not reachable
          </TooltipTrigger>
          <TooltipPopup>
            Tasks stored on a disconnected machine show again when it reconnects.
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <span className="ml-auto hidden shrink-0 items-center gap-1 lg:flex">
        <Kbd>↑↓</Kbd> move <Kbd>Enter</Kbd> edit <Kbd>X</Kbd> done
      </span>
    </div>
  );
}

function TaskRow({
  entry,
  selected,
  focusable,
  showMachine,
  onSelect,
}: {
  entry: TaskEntry;
  selected: boolean;
  focusable: boolean;
  showMachine: boolean;
  onSelect: () => void;
}) {
  const { allowed, update } = useSavedPrompts(entry.home.environmentId, entry.home.id);
  const labelOf = useEnvironmentLabel();
  const thread = useTaskThread(entry);
  const done = entry.status === "done";
  const toggleDone = () => void update({ kind: "complete", id: entry.task.id, done: !done });
  // A linked, unfinished task shows its thread's dot; the checkbox takes its place on hover or focus.
  const dot = !done && thread.state !== null;
  return (
    <div
      role="listitem"
      data-task-key={entry.key}
      className={cn(
        "group/row flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-sm has-focus-visible:ring-1 has-focus-visible:ring-ring has-focus-visible:ring-inset",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {dot ? (
          <span className="flex group-hover/row:hidden group-has-focus-visible/row:hidden">
            <TaskThreadDot state={thread.state!} />
          </span>
        ) : null}
        <span
          className={cn(
            "flex",
            dot && "hidden group-hover/row:flex group-has-focus-visible/row:flex",
          )}
        >
          <Checkbox
            aria-label={done ? "Reopen task" : "Mark task done"}
            checked={done}
            disabled={!allowed}
            tabIndex={-1}
            onCheckedChange={toggleDone}
          />
        </span>
      </span>
      <button
        type="button"
        data-task-title=""
        tabIndex={focusable ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate text-left outline-none",
          done && "text-muted-foreground line-through decoration-muted-foreground/50",
        )}
        onClick={onSelect}
        onKeyDown={(event) => {
          if ((event.key === "x" || event.key === "X") && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            if (allowed) toggleDone();
          }
        }}
      >
        {taskTitle(entry.task)}
      </button>
      {showMachine ? (
        <span className="flex max-w-24 min-w-0 shrink">
          <TaskMachineChip label={labelOf(entry.home.environmentId)} />
        </span>
      ) : null}
      <TaskAttachmentCount count={entry.task.attachments?.length ?? 0} />
    </div>
  );
}
