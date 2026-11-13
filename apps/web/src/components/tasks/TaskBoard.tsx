import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CommandId, type SavedPromptStatus } from "@t3tools/contracts";
import { ChevronsRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn, randomUUID } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TaskAttachmentCount } from "./TaskAttachments";
import {
  TASK_THREAD_STATE_LABELS,
  TaskMachineChip,
  TaskStatusMenu,
  TaskThreadDot,
  useTaskThread,
} from "./TaskParts";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  taskStatusForDrop,
  taskPriority,
  taskTitle,
  type TaskEntry,
  type TaskProjectGroup,
  type TaskRow,
} from "./tasks.logic";
import { TaskPriorityChip } from "./TaskFields";
import { TaskReviewActions, TaskReviewSummary } from "./TaskReview";
import { TaskQueueChip, useTaskQueue } from "./TaskBatch";
import type { TaskSelection } from "./TaskList";
import { Checkbox } from "../ui/checkbox";
import { useEnvironmentLabel } from "./useTaskProjects";

export function TaskBoard({
  board,
  showProject,
  selectedKey,
  onSelect,
  selection,
  besideDetail = false,
}: {
  board: Record<SavedPromptStatus, TaskRow[]>;
  showProject: boolean;
  /** A task's detail shares the width, so columns tighten and Done folds to a rail. */
  besideDetail?: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  selection: TaskSelection;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const entries = TASK_STATUSES.flatMap((status) => board[status].map((row) => row.entry));
  const updateTask = useAtomCommand(projectEnvironment.savedPromptUpdate);
  const [doneOpen, setDoneOpen] = useState(false);
  // A drop writes to the task's own machine, like every other task edit.
  const onDragEnd = (event: DragEndEvent) => {
    const entry = entries.find((candidate) => candidate.key === event.active.id);
    const status = entry ? taskStatusForDrop(entry, event.over?.id) : null;
    if (!entry || !status) return;
    void updateTask({
      environmentId: entry.home.environmentId,
      input: {
        type: "project.update",
        projectId: entry.home.id,
        commandId: CommandId.make(randomUUID()),
        savedPrompt:
          status === "approve"
            ? { kind: "approve", id: entry.task.id }
            : { kind: "edit", id: entry.task.id, status },
      },
    });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-x-auto md:overflow-y-hidden",
          besideDetail ? "gap-2 p-2" : "gap-3 p-3",
        )}
      >
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            count={board[status].length}
            narrow={besideDetail}
            folded={besideDetail && status === "done" && !doneOpen}
            onFold={status === "done" && besideDetail ? setDoneOpen : undefined}
          >
            {board[status].map(({ entry, group }) => (
              <TaskCard
                key={entry.key}
                entry={entry}
                projectLabel={showProject ? group.label : null}
                showMachine={group.multiMachine}
                group={group}
                selected={entry.key === selectedKey}
                selection={selection}
                onSelect={() => onSelect(entry.key)}
              />
            ))}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  status,
  count,
  narrow,
  folded,
  onFold,
  children,
}: {
  status: SavedPromptStatus;
  count: number;
  narrow: boolean;
  folded: boolean;
  onFold: ((open: boolean) => void) | undefined;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const label = TASK_STATUS_LABELS[status];
  if (folded)
    return (
      <section
        ref={setNodeRef}
        aria-label={label}
        className={cn(
          "flex shrink-0 rounded-lg border bg-card md:min-h-0 md:w-10",
          isOver ? "border-ring" : "border-border",
        )}
      >
        <button
          type="button"
          aria-label={`Show ${label} (${count})`}
          aria-expanded={false}
          className="flex h-10 w-full items-center gap-2 px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:h-auto md:flex-col md:px-0 md:py-3"
          onClick={() => onFold?.(true)}
        >
          <Badge variant="secondary" size="sm">
            {count}
          </Badge>
          <span className="md:[writing-mode:vertical-rl]">{label}</span>
        </button>
      </section>
    );
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        "flex shrink-0 flex-col rounded-lg border bg-card md:min-h-0 md:max-w-96 md:flex-1 md:basis-0",
        narrow ? "md:min-w-44" : "md:min-w-52",
        isOver ? "border-ring" : "border-border",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{label}</h2>
        <Badge variant="secondary" size="sm">
          {count}
        </Badge>
        {onFold ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Fold ${label}`}
            onClick={() => onFold(false)}
          >
            <ChevronsRightIcon />
          </Button>
        ) : null}
      </header>
      <div className="flex flex-col gap-2 p-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {count === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {status === "review" ? "Finished threads land here for review." : "Drop a task here."}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function TaskCard({
  entry,
  projectLabel,
  showMachine,
  group,
  selected,
  selection,
  onSelect,
}: {
  entry: TaskEntry;
  projectLabel: string | null;
  showMachine: boolean;
  group: TaskProjectGroup;
  selected: boolean;
  selection: TaskSelection;
  onSelect: () => void;
}) {
  const queue = useTaskQueue(entry);
  const pickable = entry.status !== "done";
  const picked = selection.keys.has(entry.key);
  const { allowed, update } = useSavedPrompts(entry.home.environmentId, entry.home.id);
  const labelOf = useEnvironmentLabel();
  const thread = useTaskThread(entry);
  const review = entry.status === "review" && entry.task.review !== undefined;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.key,
    disabled: !allowed,
  });
  return (
    <div
      ref={setNodeRef}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      className={cn(
        "relative flex flex-col gap-1.5 rounded-md border bg-background p-2.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring",
        selected || picked ? "border-ring" : "border-border hover:bg-accent/40",
        isDragging && "z-10 shadow-lg",
      )}
      {...listeners}
      {...attributes}
      tabIndex={-1}
      role="group"
      aria-roledescription="Task card"
    >
      <div className="flex min-w-0 items-center gap-2">
        {selection.active && pickable ? (
          <span className="relative z-1 flex">
            <Checkbox
              aria-label={picked ? "Deselect task" : "Select task"}
              checked={picked}
              onCheckedChange={() => selection.onToggle(entry.key, false)}
            />
          </span>
        ) : null}
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']"
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey;
            if (pickable && (selection.active || modified)) {
              selection.onToggle(entry.key, event.shiftKey);
              return;
            }
            onSelect();
          }}
        >
          {taskTitle(entry.task)}
        </button>
      </div>
      {review ? (
        <div className="relative z-1">
          <TaskReviewSummary entry={entry} density="card" />
        </div>
      ) : (
        entry.task.text.trim() !== taskTitle(entry.task) && (
          <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{entry.task.text}</p>
        )
      )}
      <div className="relative z-1 flex min-w-0 items-center gap-1.5">
        <TaskPriorityChip priority={taskPriority(entry.task)} />
        {projectLabel !== null ? (
          <Badge variant="outline" size="sm" className="min-w-0 max-w-36 shrink">
            <span className="truncate">{projectLabel}</span>
          </Badge>
        ) : null}
        {entry.status === "in-progress" && thread.state !== null ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <TaskThreadDot state={thread.state} />
            {TASK_THREAD_STATE_LABELS[thread.state]}
          </span>
        ) : null}
        {showMachine ? (
          <span className="flex min-w-0 max-w-24 shrink">
            <TaskMachineChip label={labelOf(entry.home.environmentId)} />
          </span>
        ) : null}
        <TaskAttachmentCount count={entry.task.attachments?.length ?? 0} />
        {queue && thread.state !== "running" ? (
          <TaskQueueChip entry={entry} group={group} queue={queue} />
        ) : null}
        <span className="ml-auto shrink-0">
          <TaskStatusMenu
            status={entry.status}
            disabled={!allowed}
            onChange={(status) => void update({ kind: "edit", id: entry.task.id, status })}
          />
        </span>
      </div>
      {review ? (
        <div className="relative z-1 border-t border-border pt-2">
          <TaskReviewActions entry={entry} showOpenThread={false} />
        </div>
      ) : null}
    </div>
  );
}
