import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ArrowLeftIcon, ListFilterIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { NewTaskDraft, type NewTaskSeed } from "./NewTaskDraft";
import { TaskBoard } from "./TaskBoard";
import { TaskCapture } from "./TaskCapture";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import {
  buildTaskBoard,
  buildTaskList,
  NO_TASK_FILTER,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  taskTagsInUse,
  type TaskFilter,
  type TaskPriority,
  type TaskProjectGroup,
} from "./tasks.logic";
import { useEnvironmentLabel, useTaskProjectGroups } from "./useTaskProjects";

const TasksView = Schema.Literals(["inbox", "project", "board"]);
type TasksView = typeof TasksView.Type;
const VIEW_LABELS: Record<TasksView, string> = {
  inbox: "Inbox",
  project: "By project",
  board: "Board",
};

export interface TasksSearch {
  readonly project?: string | undefined;
  readonly task?: string | undefined;
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

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
  const [refine, setRefine] = useState<Omit<TaskFilter, "projectKey">>(NO_TASK_FILTER);
  const filter: TaskFilter = { ...refine, projectKey };
  const [view, setView] = useLocalStorage("t3code:tasks:view-v2", "inbox", TasksView);
  const board = view === "board";
  const model = buildTaskList(groups, filter, view === "inbox" ? "inbox" : "project");
  const entries = groups.flatMap((group) => group.tasks.map((entry) => ({ entry, group })));
  const selected = entries.find(({ entry }) => entry.key === search.task) ?? null;
  const tagsInUse = taskTagsInUse(groups);
  const captureRef = useRef<HTMLInputElement>(null);
  const [tagRequestKey, setTagRequestKey] = useState<string | null>(null);
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
  const showingDetail = draft !== null || selected !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- N focuses the capture field from anywhere on the page, a window-level shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      event.preventDefault();
      captureRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const empty = (
    <TasksEmpty
      kind={model.empty === "filtered" ? "filtered" : "none"}
      label={filterLabel}
      unreachable={model.unreachable}
      onNewTask={() => captureRef.current?.focus()}
      onShowAll={() => {
        setRefine(NO_TASK_FILTER);
        go({});
      }}
    />
  );
  const toolbar = (
    <TasksToolbar
      groups={groups}
      filter={filter}
      tagsInUse={tagsInUse}
      openCount={model.openCount}
      onRefine={setRefine}
      onProject={(key) => go(key ? { project: key } : {}, false)}
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
              value={[view]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "inbox" || value === "project" || value === "board") setView(value);
              }}
            >
              {(["inbox", "project", "board"] as const).map((value) => (
                <Toggle key={value} value={value}>
                  {VIEW_LABELS[value]}
                </Toggle>
              ))}
            </ToggleGroup>
            <Button size="compact" variant="ghost" onClick={newTask}>
              <PlusIcon />
              New task
            </Button>
          </div>
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1">
          <section
            aria-label={board ? "Task board" : "Task list"}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col md:flex",
              showingDetail ? "hidden" : "flex",
            )}
          >
            <TaskCapture
              groups={groups}
              filterProjectKey={projectKey}
              inputRef={captureRef}
              onCreated={() => {}}
            />
            {toolbar}
            {board ? (
              model.empty !== null ? (
                empty
              ) : (
                <TaskBoard
                  board={buildTaskBoard(groups, filter)}
                  showProject={projectKey === null}
                  selectedKey={selected?.entry.key ?? null}
                  onSelect={(key) => go({ ...search, task: key })}
                />
              )
            ) : (
              <TaskList
                model={model}
                selectedKey={selected?.entry.key ?? null}
                showSectionHeaders={view === "inbox" || projectKey === null}
                showProject={view === "inbox" && projectKey === null}
                sortable
                tagsInUse={tagsInUse}
                onSelect={(key) => go({ ...search, task: key })}
                onOpen={(key) => go({ ...search, task: key })}
                onEditTags={(key) => {
                  go({ ...search, task: key });
                  setTagRequestKey(key);
                }}
                empty={empty}
              />
            )}
          </section>
          <main
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col md:w-[30rem] md:flex-none md:border-l md:border-border",
              showingDetail ? "flex" : "hidden",
            )}
          >
            {showingDetail ? (
              <div className="flex h-10 shrink-0 items-center justify-between px-2">
                <Button
                  size="compact"
                  variant="ghost"
                  className="md:hidden"
                  onClick={() => go({ project: search.project })}
                >
                  <ArrowLeftIcon />
                  Tasks
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="Close task"
                  className="ml-auto hidden md:inline-flex"
                  onClick={() => go({ project: search.project })}
                >
                  <XIcon />
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
              <TaskDetail
                key={selected.entry.key}
                entry={selected.entry}
                group={selected.group}
                tagsInUse={tagsInUse}
                startAddingTag={tagRequestKey === selected.entry.key}
                onAddingTagChange={(adding) => {
                  if (!adding) setTagRequestKey(null);
                }}
              />
            ) : null}
          </main>
        </div>
      </div>
    </SidebarInset>
  );
}

/** Search, the project filter and the narrower filters, with active ones as removable chips. */
function TasksToolbar({
  groups,
  filter,
  tagsInUse,
  openCount,
  onRefine,
  onProject,
}: {
  groups: ReadonlyArray<TaskProjectGroup>;
  filter: TaskFilter;
  tagsInUse: ReadonlyArray<string>;
  openCount: number;
  onRefine: (next: Omit<TaskFilter, "projectKey">) => void;
  onProject: (key: string | null) => void;
}) {
  const labelOf = useEnvironmentLabel();
  const { projectKey: _projectKey, ...refine } = filter;
  const set = (patch: Partial<Omit<TaskFilter, "projectKey">>) => onRefine({ ...refine, ...patch });
  const projectLabel = groups.find((group) => group.key === filter.projectKey)?.label ?? "Project";
  const projectOptions = groups.filter(
    (group) => group.tasks.length > 0 || group.key === filter.projectKey,
  );
  const machines = [
    ...new Set(groups.flatMap((group) => group.tasks.map((entry) => entry.home.environmentId))),
  ].toSorted((left, right) => labelOf(left).localeCompare(labelOf(right)));
  const chips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(filter.priority
      ? [
          {
            key: "priority",
            label: TASK_PRIORITY_LABELS[filter.priority],
            clear: () => set({ priority: null }),
          },
        ]
      : []),
    ...(filter.tag
      ? [{ key: "tag", label: `#${filter.tag}`, clear: () => set({ tag: null }) }]
      : []),
    ...(filter.environmentId
      ? [
          {
            key: "machine",
            label: labelOf(filter.environmentId),
            clear: () => set({ environmentId: null }),
          },
        ]
      : []),
  ];
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <InputGroup className="w-56 shrink">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          size="compact"
          type="search"
          aria-label="Search tasks"
          placeholder="Search"
          value={filter.query}
          onChange={(event) => set({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter.query) {
              event.preventDefault();
              set({ query: "" });
            }
          }}
        />
      </InputGroup>
      <div className="w-40 min-w-0 shrink">
        <Select
          value={filter.projectKey ?? "all"}
          onValueChange={(value) => onProject(value && value !== "all" ? value : null)}
        >
          <SelectTrigger size="compact" aria-label="Filter tasks by project">
            <SelectValue>
              {(value: string) => (value === "all" ? "All projects" : projectLabel)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All projects</SelectItem>
            {projectOptions.map((group) => (
              <SelectItem key={group.key} value={group.key}>
                {group.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <Menu>
        <MenuTrigger render={<Button size="icon-sm" variant="ghost-muted" aria-label="Filter" />}>
          <ListFilterIcon />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-44">
          <MenuSub>
            <MenuSubTrigger>Priority</MenuSubTrigger>
            <MenuSubPopup>
              <FilterRadio
                value={filter.priority ?? ""}
                options={[
                  { value: "", label: "Any priority" },
                  ...TASK_PRIORITIES.map((value) => ({
                    value,
                    label: TASK_PRIORITY_LABELS[value],
                  })),
                ]}
                onChange={(value) => set({ priority: (value || null) as TaskPriority | null })}
              />
            </MenuSubPopup>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger disabled={tagsInUse.length === 0}>Tag</MenuSubTrigger>
            <MenuSubPopup>
              <FilterRadio
                value={filter.tag ?? ""}
                options={[
                  { value: "", label: "Any tag" },
                  ...tagsInUse.map((tag) => ({ value: tag, label: tag })),
                ]}
                onChange={(value) => set({ tag: value || null })}
              />
            </MenuSubPopup>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger disabled={machines.length < 2}>Machine</MenuSubTrigger>
            <MenuSubPopup>
              <FilterRadio
                value={filter.environmentId ?? ""}
                options={[
                  { value: "", label: "Any machine" },
                  ...machines.map((id) => ({ value: id, label: labelOf(id) })),
                ]}
                onChange={(value) =>
                  set({ environmentId: (value || null) as EnvironmentId | null })
                }
              />
            </MenuSubPopup>
          </MenuSub>
        </MenuPopup>
      </Menu>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {chips.map((chip) => (
          <Badge
            key={chip.key}
            variant="outline"
            size="control"
            render={<button type="button" aria-label={`Clear filter ${chip.label}`} />}
            onClick={chip.clear}
          >
            <span className="max-w-28 truncate">{chip.label}</span>
            <XIcon />
          </Badge>
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{openCount} open</span>
    </div>
  );
}

function FilterRadio({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <MenuRadioGroup value={value} onValueChange={(next: string) => onChange(next)}>
      {options.map((option) => (
        <MenuRadioItem key={option.value || "any"} value={option.value} closeOnClick>
          <span className="flex min-w-0 items-center gap-2">
            <MenuRadioItemIndicator className="w-3.5" />
            <span className="truncate">{option.label}</span>
          </span>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
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
        <EmptyTitle>{kind === "none" ? "No tasks yet" : "No matching tasks"}</EmptyTitle>
        <EmptyDescription>
          {kind === "none"
            ? "Type one above and press Enter, or save a prompt from the composer with Save for later."
            : `Nothing in ${label === "Project" ? "this view" : label} matches the filters.`}
          {unreachable > 0
            ? ` ${unreachable} ${unreachable === 1 ? "machine is" : "machines are"} not reachable, so some tasks may be missing.`
            : ""}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {kind === "none" ? (
          <Button size="compact" variant="outline" onClick={onNewTask}>
            <PlusIcon />
            Add a task
          </Button>
        ) : (
          <Button size="compact" variant="outline" onClick={onShowAll}>
            Clear filters
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
