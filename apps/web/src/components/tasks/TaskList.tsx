import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CommandId, type SavedPromptAction } from "@t3tools/contracts";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { cn, randomUUID } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Kbd } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TaskAttachmentCount } from "./TaskAttachments";
import { TaskQueueChip, useTaskQueue } from "./TaskBatch";
import { TaskFieldMenuItems, TaskPriorityChip, taskShortcutAction } from "./TaskFields";
import { TaskMachineChip, TaskRunningLabel, TaskThreadDot, useTaskThread } from "./TaskParts";
import {
  adjacentTaskKey,
  taskDropPlan,
  taskListOrder,
  taskPriority,
  taskReviewView,
  taskSubtaskCounts,
  taskSubtasks,
  taskTitle,
  type TaskEntry,
  type TaskListModel,
  type TaskListSection,
  type TaskRow as TaskRowModel,
} from "./tasks.logic";
import { useEnvironmentLabel } from "./useTaskProjects";

const SECTION_DROP_PREFIX = "section:";

/** Multi-select for batch runs: Cmd/Ctrl-click toggles, Shift-click selects a range. */
export interface TaskSelection {
  readonly active: boolean;
  readonly keys: ReadonlySet<string>;
  readonly onToggle: (key: string, range: boolean) => void;
}

export function TaskList({
  model,
  selectedKey,
  onSelect,
  onOpen,
  showSectionHeaders,
  showProject,
  sortable,
  tagsInUse,
  onEditTags,
  empty,
  renderExpanded,
  selection = null,
}: {
  model: TaskListModel;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  showSectionHeaders: boolean;
  /** Rows name their project; off when the list shows one project. */
  showProject: boolean;
  /** Rows drag to reorder and, in the inbox, between Today and Later. */
  sortable: boolean;
  tagsInUse: ReadonlyArray<string>;
  /** Opens the task with its tag field ready; null where the list has no detail. */
  onEditTags: ((key: string) => void) | null;
  empty: ReactNode;
  /** Shown under the selected row, for editors that open in place. */
  renderExpanded?: (entry: TaskEntry) => ReactNode;
  selection?: TaskSelection | null;
}) {
  const [doneExpanded, setDoneExpanded] = useState(false);
  const clearDone = useClearDone(model);
  const listRef = useRef<HTMLDivElement>(null);
  const order = taskListOrder(model, doneExpanded);
  const focusKey = selectedKey !== null && order.includes(selectedKey) ? selectedKey : order[0];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const updateTask = useAtomCommand(projectEnvironment.savedPromptUpdate);
  const focusRow = (key: string) =>
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-task-key="${CSS.escape(key)}"] [data-task-title]`)
      ?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-task-title")) {
      return;
    }
    const current = event.target.closest<HTMLElement>("[data-task-key]")?.dataset.taskKey;
    if (current === undefined) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = adjacentTaskKey(order, current, event.key === "ArrowDown" ? 1 : -1);
      if (next !== null) {
        onSelect(next);
        focusRow(next);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpen(current);
    }
  };
  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over?.id;
    if (over === undefined) return;
    const overId = String(over);
    const sectionId = overId.startsWith(SECTION_DROP_PREFIX)
      ? overId.slice(SECTION_DROP_PREFIX.length)
      : model.sections.find((section) => section.rows.some((row) => row.entry.key === overId))?.id;
    if (sectionId === undefined) return;
    const plan = taskDropPlan(model, String(event.active.id), {
      sectionId,
      overKey: overId.startsWith(SECTION_DROP_PREFIX) ? null : overId,
    });
    if (plan === null) return;
    const send = (savedPrompt: SavedPromptAction) =>
      updateTask({
        environmentId: plan.entry.home.environmentId,
        input: {
          type: "project.update",
          projectId: plan.entry.home.id,
          commandId: CommandId.make(randomUUID()),
          savedPrompt,
        },
      });
    void (async () => {
      if (plan.when !== null) await send({ kind: "edit", id: plan.entry.task.id, when: plan.when });
      if (plan.reorder !== null) await send({ kind: "reorder", ids: plan.reorder });
    })();
  };

  if (model.empty !== null) return <div className="flex min-h-0 flex-1 flex-col">{empty}</div>;
  const renderRows = (rows: ReadonlyArray<TaskRowModel>, draggable: boolean) =>
    rows.map((row) => (
      <Fragment key={row.entry.key}>
        <TaskRow
          row={row}
          selected={row.entry.key === selectedKey}
          focusable={row.entry.key === focusKey}
          showProject={showProject}
          draggable={draggable}
          tagsInUse={tagsInUse}
          selection={selection}
          onSelect={() => onSelect(row.entry.key)}
          onEditTags={onEditTags ? () => onEditTags(row.entry.key) : null}
        />
        {renderExpanded && row.entry.key === selectedKey ? (
          <div className="px-2 pt-1 pb-3">{renderExpanded(row.entry)}</div>
        ) : null}
      </Fragment>
    ));
  const allOpenEmpty = model.openCount === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragEnd={onDragEnd}
      >
        <div
          ref={listRef}
          role="list"
          aria-label="Tasks"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
          onKeyDown={onKeyDown}
        >
          {model.sections.map((section) =>
            // An empty inbox section stays as a drop target unless nothing is open at all.
            section.rows.length === 0 && (section.when === null || allOpenEmpty) ? null : (
              <TaskSection
                key={section.id}
                section={section}
                showHeader={showSectionHeaders}
                droppable={sortable && section.when !== null}
              >
                <SortableContext
                  items={section.rows.map((row) => row.entry.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {renderRows(section.rows, sortable)}
                </SortableContext>
              </TaskSection>
            ),
          )}
          {allOpenEmpty ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Nothing open. Nice.</p>
          ) : null}
          {model.doneCount > 0 ? (
            <div className="mt-2 flex flex-col">
              <div className="flex h-8 items-center justify-between gap-2 pr-1">
                <button
                  type="button"
                  aria-expanded={doneExpanded}
                  className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => setDoneExpanded(!doneExpanded)}
                >
                  <ChevronRightIcon
                    className={cn("size-3.5 shrink-0", doneExpanded && "rotate-90")}
                  />
                  Done <span className="tabular-nums">· {model.doneCount}</span>
                </button>
                {clearDone.allowed ? (
                  <Button size="micro" variant="ghost-muted" onClick={() => void clearDone.run()}>
                    Clear done
                  </Button>
                ) : null}
              </div>
              {doneExpanded ? renderRows(model.done, false) : null}
            </div>
          ) : null}
        </div>
      </DndContext>
      <TaskListFooter unreachable={model.unreachable} />
    </div>
  );
}

function TaskSection({
  section,
  showHeader,
  droppable,
  children,
}: {
  section: TaskListSection;
  showHeader: boolean;
  droppable: boolean;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${SECTION_DROP_PREFIX}${section.id}`,
    disabled: !droppable,
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={section.label}
      className={cn(
        "flex flex-col rounded-md not-first:mt-2",
        isOver && section.rows.length === 0 && "bg-accent/50",
      )}
    >
      {showHeader ? (
        <h3 className="flex h-8 min-w-0 items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <span className="truncate">{section.label}</span>
          <span className="shrink-0 tabular-nums">· {section.rows.length}</span>
        </h3>
      ) : null}
      {children}
    </section>
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
        <Kbd>N</Kbd> new <Kbd>↑↓</Kbd> move <Kbd>1</Kbd>
        <Kbd>2</Kbd>
        <Kbd>3</Kbd> priority <Kbd>T</Kbd> today <Kbd>X</Kbd> done
      </span>
    </div>
  );
}

const MAX_ROW_TAGS = 2;

function TaskRow({
  row,
  selected,
  focusable,
  showProject,
  draggable,
  tagsInUse,
  selection,
  onSelect,
  onEditTags,
}: {
  row: TaskRowModel;
  selected: boolean;
  focusable: boolean;
  showProject: boolean;
  draggable: boolean;
  tagsInUse: ReadonlyArray<string>;
  selection: TaskSelection | null;
  onSelect: () => void;
  onEditTags: (() => void) | null;
}) {
  const { entry, group, depth } = row;
  const queue = useTaskQueue(entry);
  const picking = selection !== null && selection.active && entry.status !== "done";
  const picked = selection?.keys.has(entry.key) ?? false;
  const { allowed, update } = useSavedPrompts(entry.home.environmentId, entry.home.id);
  const labelOf = useEnvironmentLabel();
  const thread = useTaskThread(entry);
  const done = entry.status === "done";
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: entry.key,
    disabled: !draggable || !allowed || done,
  });
  const toggleDone = () => void update({ kind: "complete", id: entry.task.id, done: !done });
  const tags = entry.task.tags ?? [];
  const subtasks = taskSubtaskCounts(depth === 0 ? taskSubtasks(group, entry) : []);
  // A linked, unfinished task shows its thread's dot; the checkbox takes its place on hover or focus.
  const dot = !done && thread.state !== null;
  const running = !done && thread.state === "running";
  return (
    <div
      ref={setNodeRef}
      data-task-key={entry.key}
      style={
        transform
          ? {
              transform: `translate3d(0, ${Math.round(transform.y)}px, 0)`,
              transition: transition,
            }
          : undefined
      }
      className={cn(
        "group/row relative flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md pr-1 text-sm has-focus-visible:ring-1 has-focus-visible:ring-ring has-focus-visible:ring-inset",
        depth === 1 ? "pl-8" : "pl-2",
        selected || picked ? "bg-accent" : "hover:bg-accent/50",
        isDragging && "z-10 bg-accent shadow-md",
      )}
      {...attributes}
      {...listeners}
      role="listitem"
      tabIndex={-1}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {picking ? (
          <Checkbox
            aria-label={picked ? "Deselect task" : "Select task"}
            checked={picked}
            tabIndex={-1}
            onCheckedChange={() => selection!.onToggle(entry.key, false)}
          />
        ) : null}
        {!picking && dot ? (
          <span className="flex group-hover/row:hidden group-has-focus-visible/row:hidden">
            <TaskThreadDot state={thread.state!} />
          </span>
        ) : null}
        {picking ? null : (
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
        )}
      </span>
      <span className="flex w-6 shrink-0 justify-center">
        <TaskPriorityChip priority={taskPriority(entry.task)} />
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
        onClick={(event) => {
          const modified = event.metaKey || event.ctrlKey || event.shiftKey;
          if (selection && entry.status !== "done" && (selection.active || modified)) {
            event.preventDefault();
            selection.onToggle(entry.key, event.shiftKey);
            return;
          }
          onSelect();
        }}
        onKeyDown={(event) => {
          if ((event.key === "x" || event.key === "X") && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            if (allowed) toggleDone();
            return;
          }
          const action = taskShortcutAction(entry, event);
          if (action !== null) {
            event.preventDefault();
            if (allowed) void update(action);
          }
        }}
      >
        {taskTitle(entry.task)}
      </button>
      {showProject ? (
        <Badge variant="outline" size="sm" className="min-w-0 max-w-32">
          <span className="truncate">{group.label}</span>
        </Badge>
      ) : null}
      {group.multiMachine ? (
        <span className="hidden max-w-24 min-w-0 shrink sm:flex">
          <TaskMachineChip label={labelOf(entry.home.environmentId)} />
        </span>
      ) : null}
      {tags.slice(0, MAX_ROW_TAGS).map((tag) => (
        <Badge
          key={tag}
          variant="quiet"
          size="sm"
          className="hidden max-w-20 min-w-0 sm:inline-flex"
        >
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {tags.length > MAX_ROW_TAGS ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
          +{tags.length - MAX_ROW_TAGS}
        </span>
      ) : null}
      {subtasks.total > 0 ? (
        <span
          aria-label={`${subtasks.done} of ${subtasks.total} subtasks done`}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {subtasks.done}/{subtasks.total}
        </span>
      ) : null}
      <TaskAttachmentCount count={entry.task.attachments?.length ?? 0} />
      {running ? <TaskRunningLabel startedAt={thread.shell?.latestRun?.startedAt ?? null} /> : null}
      {queue && !done && !running ? (
        <TaskQueueChip entry={entry} group={group} queue={queue} />
      ) : null}
      {entry.status === "review" && entry.task.review ? (
        <Badge variant={taskReviewView(entry.task.review).tone} size="sm">
          {taskReviewView(entry.task.review).outcome}
        </Badge>
      ) : null}
      <Menu>
        <span className="flex shrink-0 opacity-0 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 has-data-popup-open:opacity-100">
          <MenuTrigger
            disabled={!allowed}
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Task options"
                tabIndex={-1}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
        </span>
        <MenuPopup align="end" className="min-w-48">
          <TaskFieldMenuItems
            entry={entry}
            tagsInUse={tagsInUse}
            onUpdate={(action) => void update(action)}
            onEditTags={onEditTags}
          />
          <MenuSeparator />
          <MenuItem onClick={toggleDone}>
            {done ? "Reopen" : "Mark done"}
            <MenuShortcut>X</MenuShortcut>
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

/** Clears the listed done tasks on every machine that stores them; Undo restores each one. */
function useClearDone(model: TaskListModel) {
  const run = useAtomCommand(projectEnvironment.savedPromptUpdate);
  const homes = new Map<string, TaskEntry[]>();
  for (const { entry } of model.done) {
    const key = `${entry.home.environmentId}:${entry.home.id}`;
    homes.set(key, [...(homes.get(key) ?? []), entry]);
  }
  const mutate = (
    entry: TaskEntry,
    savedPrompt: { kind: "clear-done" } | { kind: "restore"; id: string },
  ) =>
    run({
      environmentId: entry.home.environmentId,
      input: {
        type: "project.update",
        projectId: entry.home.id,
        commandId: CommandId.make(randomUUID()),
        savedPrompt,
      },
    });
  return {
    allowed: homes.size > 0,
    run: async () => {
      const groups = [...homes.values()];
      const results = await Promise.all(
        groups.map((entries) => mutate(entries[0]!, { kind: "clear-done" })),
      );
      const cleared = groups.filter((_, index) => results[index]?._tag === "Success").flat();
      if (cleared.length === 0) return;
      toastManager.add({
        type: "success",
        title: `Cleared ${cleared.length} done ${cleared.length === 1 ? "task" : "tasks"}`,
        actionProps: {
          children: "Undo",
          onClick: () =>
            void Promise.all(
              cleared.map((entry) => mutate(entry, { kind: "restore", id: entry.task.id })),
            ),
        },
      });
    },
  };
}
