import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import { ArrowUpRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import {
  buildTaskList,
  findTaskGroupForProject,
  NO_TASK_FILTER,
  taskTagsInUse,
} from "./tasks.logic";
import { useTaskProjectGroups } from "./useTaskProjects";

/** The chat's quick view of its logical project's tasks, inside the right panel. */
export function TasksPanel({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const groups = useTaskProjectGroups();
  const group = findTaskGroupForProject(groups, environmentId, projectId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  if (!group) return null;
  const model = buildTaskList([group], { ...NO_TASK_FILTER, projectKey: group.key });
  return (
    <section aria-label={gt("Tasks")} className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="min-w-0 truncate text-sm font-medium">{group.label}</h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          <T>
            <Var>{model.openCount}</Var> open
          </T>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label={gt("New task")}
            onClick={() => void navigate({ to: "/tasks/new", search: { project: group.key } })}
          >
            <PlusIcon />
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              void navigate({
                to: "/tasks",
                search: { project: group.key, ...(selectedKey ? { task: selectedKey } : {}) },
              })
            }
          >
            <T>Open in Tasks</T>
            <ArrowUpRightIcon />
          </Button>
        </div>
      </header>
      <TaskList
        model={model}
        selectedKey={selectedKey}
        showSectionHeaders={false}
        showProject={false}
        sortable
        tagsInUse={taskTagsInUse([group])}
        onEditTags={null}
        onSelect={(key) => setSelectedKey(key === selectedKey ? null : key)}
        onOpen={(key) => setSelectedKey(key)}
        renderExpanded={(entry) => (
          <TaskDetail
            key={entry.key}
            entry={entry}
            group={group}
            density="compact"
            tagsInUse={taskTagsInUse([group])}
          />
        )}
        empty={
          <Empty size="compact">
            <EmptyHeader>
              <EmptyTitle>
                <T>
                  No tasks in <Var>{group.label}</Var>
                </T>
              </EmptyTitle>
              <EmptyDescription>
                <T>Save a prompt for later from the composer, or add one with +.</T>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </section>
  );
}
