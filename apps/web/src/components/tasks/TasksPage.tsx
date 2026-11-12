import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, type ProjectSavedPrompt } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PaperclipIcon } from "lucide-react";
import { useState } from "react";
import { isElectron } from "../../env";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { useProjects, useThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Route } from "../../routes/_chat.tasks";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { TaskDetail } from "./TaskDetail";
import { taskStatus, taskThreadRunning, taskTitle } from "./tasks.logic";

export function TasksPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const primary = usePrimaryEnvironmentId();
  const environmentId = search.environment ? EnvironmentId.make(search.environment) : primary;
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId && (!search.project || project.id === search.project),
  );
  const allProjects = useProjects().filter((project) => project.environmentId === environmentId);
  const [selected, setSelected] = useState<{ projectId: string; id: string } | null>(null);
  const entries = projects.flatMap((project) =>
    (project.savedPrompts ?? []).map((task) => ({ project, task })),
  );
  const open = entries.filter(({ task }) => taskStatus(task) !== "done");
  const done = entries.filter(({ task }) => taskStatus(task) === "done");
  const chosen =
    entries.find(
      ({ project, task }) => project.id === selected?.projectId && task.id === selected.id,
    ) ?? (selected ? null : (open[0] ?? done[0]));
  const pick = (project: EnvironmentProject, task: ProjectSavedPrompt) =>
    setSelected({ projectId: project.id, id: task.id });
  return (
    <SidebarInset className="h-dvh min-w-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="text-sm font-medium">Tasks</h1>
        <span className="text-xs text-muted-foreground">{open.length} open</span>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <aside
          aria-label="Task list"
          className={`${chosen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-border md:w-72 lg:w-80`}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 px-3">
            <div className="min-w-0 flex-1">
              <Select
                value={search.project ?? "all"}
                onValueChange={(value) => {
                  setSelected(null);
                  void navigate({
                    to: "/tasks",
                    search: {
                      ...(environmentId ? { environment: environmentId } : {}),
                      ...(value && value !== "all" ? { project: value } : {}),
                    },
                  });
                }}
              >
                <SelectTrigger size="compact" aria-label="Filter tasks by project">
                  <SelectValue>
                    {(value: string) =>
                      value === "all"
                        ? "All projects"
                        : (allProjects.find((project) => project.id === value)?.title ?? "Project")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">All projects</SelectItem>
                  {allProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <span className="text-xs text-muted-foreground">{open.length} open</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {projects.map((project) => {
              const items = (project.savedPrompts ?? []).filter(
                (task) => taskStatus(task) !== "done",
              );
              return items.length ? (
                <TaskGroup
                  key={project.id}
                  project={project}
                  items={items}
                  selected={chosen?.task.id ?? null}
                  onSelect={(task) => pick(project, task)}
                />
              ) : null;
            })}
            {open.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Save a prompt from the composer to add a task.
              </p>
            ) : null}
            {done.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer px-2 py-2 text-xs text-muted-foreground">
                  Done · {done.length}
                </summary>
                {projects.map((project) => {
                  const items = (project.savedPrompts ?? []).filter(
                    (task) => taskStatus(task) === "done",
                  );
                  return items.length ? (
                    <TaskGroup
                      key={project.id}
                      project={project}
                      items={items}
                      selected={chosen?.task.id ?? null}
                      onSelect={(task) => pick(project, task)}
                      done
                    />
                  ) : null;
                })}
              </details>
            ) : null}
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1">
          {chosen ? (
            <>
              <div className="p-2 md:hidden">
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setSelected({ projectId: "", id: "" })}
                >
                  Back to tasks
                </Button>
              </div>
              <TaskDetail
                key={`${chosen.project.id}:${chosen.task.id}`}
                task={chosen.task}
                project={chosen.project}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              Select a task to edit its prompt.
            </div>
          )}
        </main>
      </div>
    </SidebarInset>
  );
}

function TaskGroup({
  project,
  items,
  selected,
  onSelect,
  done = false,
}: {
  project: EnvironmentProject;
  items: ReadonlyArray<ProjectSavedPrompt>;
  selected: string | null;
  onSelect: (task: ProjectSavedPrompt) => void;
  done?: boolean;
}) {
  const { allowed, update } = useSavedPrompts(project.environmentId, project.id);
  return (
    <section className="mb-3">
      <div className="flex h-8 items-center justify-between px-2 text-xs text-muted-foreground">
        <h2>
          {project.title} · {items.length}
        </h2>
        {done ? (
          <Button
            size="micro"
            variant="ghost"
            disabled={!allowed}
            onClick={() => void update({ kind: "clear-done" })}
          >
            Clear done
          </Button>
        ) : null}
      </div>
      {items.map((task) => (
        <TaskListRow
          key={task.id}
          task={task}
          project={project}
          selected={task.id === selected}
          onSelect={() => onSelect(task)}
        />
      ))}
    </section>
  );
}

function TaskListRow({
  task,
  project,
  selected,
  onSelect,
}: {
  task: ProjectSavedPrompt;
  project: EnvironmentProject;
  selected: boolean;
  onSelect: () => void;
}) {
  const { allowed, update } = useSavedPrompts(project.environmentId, project.id);
  const linked = useThreadShell(
    task.latestThreadId ? scopeThreadRef(project.environmentId, task.latestThreadId) : null,
  );
  const running = taskThreadRunning(linked?.runtime?.status ?? linked?.latestRun?.status);
  return (
    <div
      className={`flex h-8 items-center gap-2 rounded-lg px-2 text-sm ${selected ? "bg-accent" : "hover:bg-accent/40"}`}
    >
      <Checkbox
        aria-label={taskStatus(task) === "done" ? "Reopen task" : "Mark task done"}
        checked={taskStatus(task) === "done"}
        disabled={!allowed}
        onCheckedChange={() =>
          void update({ kind: "complete", id: task.id, done: taskStatus(task) !== "done" })
        }
      />
      {linked ? (
        <span
          role="img"
          aria-label={running ? "Thread running" : "Thread finished"}
          className={`size-1.5 shrink-0 rounded-full ${running ? "bg-info" : "bg-success"}`}
        />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        {taskTitle(task)}
      </button>
      {task.attachments?.length ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <PaperclipIcon className="size-3" />
          {task.attachments.length}
        </span>
      ) : null}
    </div>
  );
}
