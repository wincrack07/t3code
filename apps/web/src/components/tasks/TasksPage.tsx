import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ArrowLeftIcon, KanbanIcon, ListIcon, PlusIcon } from "lucide-react";
import { useRef } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { NewTaskDraft, type NewTaskSeed } from "./NewTaskDraft";
import { TaskBoard } from "./TaskBoard";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import { buildTaskBoard, buildTaskList, type TaskProjectGroup } from "./tasks.logic";
import { useTaskProjectGroups } from "./useTaskProjects";

const TasksView = Schema.Literals(["list", "board"]);

export interface TasksSearch {
  readonly project?: string | undefined;
  readonly task?: string | undefined;
}

export function TasksPage({
  search,
  draft = null,
}: {
  search: TasksSearch;
  draft?: NewTaskSeed | null;
}) {
  const navigate = useNavigate();
  const groups = useTaskProjectGroups();
  const projectKey = search.project ?? null;
  const model = buildTaskList(groups, projectKey);
  const entries = groups.flatMap((group) => group.tasks.map((entry) => ({ entry, group })));
  const selected = entries.find(({ entry }) => entry.key === search.task) ?? null;
  const detailRef = useRef<HTMLDivElement>(null);
  const go = (next: TasksSearch, replace = true) =>
    void navigate({
      to: "/tasks",
      search: {
        ...(next.project ? { project: next.project } : {}),
        ...(next.task ? { task: next.task } : {}),
      },
      replace,
    });
  const newTask = () =>
    void navigate({ to: "/tasks/new", search: projectKey ? { project: projectKey } : {} });
  const filterLabel = groups.find((group) => group.key === projectKey)?.label ?? "Project";
  const filterOptions = groups.filter(
    (group) => group.tasks.length > 0 || group.key === projectKey,
  );
  const showingDetail = draft !== null || selected !== null;
  const [view, setView] = useLocalStorage("t3code:tasks:view", "list", TasksView);
  const board = view === "board";
  const filter = (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <div className={cn("min-w-0", board ? "w-64" : "flex-1")}>
        <Select
          value={projectKey ?? "all"}
          onValueChange={(value) => go(value && value !== "all" ? { project: value } : {}, false)}
        >
          <SelectTrigger size="compact" aria-label="Filter tasks by project">
            <SelectValue>
              {(value: string) => (value === "all" ? "All projects" : filterLabel)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All projects</SelectItem>
            {filterOptions.map((group) => (
              <SelectItem key={group.key} value={group.key}>
                {group.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {model.openCount} open
      </span>
      {board && model.unreachable > 0 ? (
        <span className="truncate text-xs text-muted-foreground">
          · {model.unreachable} {model.unreachable === 1 ? "machine" : "machines"} not reachable
        </span>
      ) : null}
    </div>
  );
  const empty = (
    <TasksEmpty
      kind={model.empty === "filtered" ? "filtered" : "none"}
      label={filterLabel}
      unreachable={model.unreachable}
      onNewTask={newTask}
      onShowAll={() => go({})}
    />
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="truncate text-sm font-medium">Tasks</h1>
          <div className="ml-auto flex items-center gap-2">
            <ToggleGroup
              aria-label="Tasks view"
              size="compact"
              value={[view]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "list" || value === "board") setView(value);
              }}
            >
              <Toggle value="list" aria-label="List">
                <ListIcon />
              </Toggle>
              <Toggle value="board" aria-label="Board">
                <KanbanIcon />
              </Toggle>
            </ToggleGroup>
            <Button size="compact" variant="ghost" onClick={newTask}>
              <PlusIcon />
              New task
            </Button>
          </div>
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1">
          {board ? (
            <section
              aria-label="Task board"
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col md:flex",
                showingDetail ? "hidden" : "flex",
              )}
            >
              {filter}
              {model.empty !== null ? (
                empty
              ) : (
                <TaskBoard
                  board={buildTaskBoard(groups, projectKey)}
                  groups={groups}
                  selectedKey={selected?.entry.key ?? null}
                  onSelect={(key) => go({ ...search, task: key })}
                />
              )}
            </section>
          ) : (
            <aside
              aria-label="Task list"
              className={cn(
                "min-h-0 w-full shrink-0 flex-col border-r border-border md:flex md:w-80",
                showingDetail ? "hidden" : "flex",
              )}
            >
              {filter}
              <TaskList
                model={model}
                selectedKey={selected?.entry.key ?? null}
                showProjectCaptions={projectKey === null}
                onSelect={(key) => go({ ...search, task: key })}
                onOpen={(key) => {
                  go({ ...search, task: key });
                  detailRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
                }}
                empty={empty}
              />
            </aside>
          )}
          <main
            ref={detailRef}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col",
              board
                ? cn(
                    "md:w-[30rem] md:flex-none md:border-l md:border-border",
                    showingDetail ? "flex" : "hidden",
                  )
                : cn("md:flex", showingDetail ? "flex" : "hidden"),
            )}
          >
            {showingDetail ? (
              <div className="flex h-10 shrink-0 items-center px-2 md:hidden">
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => go({ project: search.project })}
                >
                  <ArrowLeftIcon />
                  Tasks
                </Button>
              </div>
            ) : null}
            {draft !== null ? (
              <NewTaskDraft
                groups={groups}
                seed={draft}
                onSaved={(key) => go({ project: search.project, task: key })}
                onDiscard={() => go({ project: search.project })}
              />
            ) : selected ? (
              <TaskDetail key={selected.entry.key} entry={selected.entry} group={selected.group} />
            ) : board ? null : (
              <NoSelection groups={groups} onNewTask={newTask} />
            )}
          </main>
        </div>
      </div>
    </SidebarInset>
  );
}

function TasksEmpty({
  kind,
  label,
  unreachable,
  onNewTask,
  onShowAll,
}: {
  kind: "none" | "filtered";
  label: string;
  unreachable: number;
  onNewTask: () => void;
  onShowAll: () => void;
}) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyTitle>{kind === "none" ? "No tasks yet" : `No tasks in ${label}`}</EmptyTitle>
        <EmptyDescription>
          {kind === "none"
            ? "Save a prompt from the composer with Save for later, or write one here."
            : "Tasks saved in other projects are under All projects."}
          {unreachable > 0
            ? ` ${unreachable} ${unreachable === 1 ? "machine is" : "machines are"} not reachable, so some tasks may be missing.`
            : ""}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {kind === "none" ? (
          <Button size="compact" variant="outline" onClick={onNewTask}>
            <PlusIcon />
            New task
          </Button>
        ) : (
          <Button size="compact" variant="outline" onClick={onShowAll}>
            Show all projects
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

function NoSelection({
  groups,
  onNewTask,
}: {
  groups: ReadonlyArray<TaskProjectGroup>;
  onNewTask: () => void;
}) {
  const any = groups.some((group) => group.tasks.length > 0);
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyTitle>{any ? "No task selected" : "Write down what's next"}</EmptyTitle>
        <EmptyDescription>
          {any
            ? "Choose a task to edit its prompt or start a thread from it."
            : "Tasks keep prompts for later, per project, on every machine you connect."}
        </EmptyDescription>
      </EmptyHeader>
      {any ? null : (
        <EmptyContent>
          <Button size="compact" variant="outline" onClick={onNewTask}>
            <PlusIcon />
            New task
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
