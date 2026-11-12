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
import type { ReactNode } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn, randomUUID } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
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
  type TaskRow,
} from "./tasks.logic";
import { TaskPriorityChip } from "./TaskFields";
import { TaskReviewActions, TaskReviewSummary } from "./TaskReview";
import { useEnvironmentLabel } from "./useTaskProjects";

export function TaskBoard({
  board,
  showProject,
  selectedKey,
  onSelect,
}: {
  board: Record<SavedPromptStatus, TaskRow[]>;
  showProject: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const entries = TASK_STATUSES.flatMap((status) => board[status].map((row) => row.entry));
  const updateTask = useAtomCommand(projectEnvironment.savedPromptUpdate);
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
        {TASK_STATUSES.map((status) => (
          <BoardColumn key={status} status={status} count={board[status].length}>
            {board[status].map(({ entry, group }) => (
              <TaskCard
                key={entry.key}
                entry={entry}
                projectLabel={showProject ? group.label : null}
                showMachine={group.multiMachine}
                selected={entry.key === selectedKey}
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
  children,
}: {
  status: SavedPromptStatus;
  count: number;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={TASK_STATUS_LABELS[status]}
      className={cn(
        "flex shrink-0 flex-col rounded-lg border bg-card md:min-h-0 md:min-w-52 md:max-w-96 md:flex-1 md:basis-0",
        isOver ? "border-ring" : "border-border",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {TASK_STATUS_LABELS[status]}
        </h2>
        <Badge variant="secondary" size="sm">
          {count}
        </Badge>
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
  selected,
  onSelect,
}: {
  entry: TaskEntry;
  projectLabel: string | null;
  showMachine: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
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
        selected ? "border-ring" : "border-border hover:bg-accent/40",
        isDragging && "z-10 shadow-lg",
      )}
      {...listeners}
      {...attributes}
      tabIndex={-1}
      role="group"
      aria-roledescription="Task card"
    >
      <button
        type="button"
        className="truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']"
        onClick={onSelect}
      >
        {taskTitle(entry.task)}
      </button>
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
          <Badge variant="outline" size="sm" className="min-w-0 max-w-36">
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
