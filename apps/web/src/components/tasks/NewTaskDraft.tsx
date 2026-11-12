import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { NewTaskLink } from "@t3tools/shared/promptLinks";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { randomUUID } from "../../lib/utils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TaskDetail } from "./TaskDetail";

const projectKey = (project: EnvironmentProject) =>
  scopedProjectKey(scopeProjectRef(project.environmentId, project.id));

export function NewTaskDraft({
  link,
  projects,
  initialProject,
}: {
  link: NewTaskLink;
  projects: ReadonlyArray<EnvironmentProject>;
  initialProject: EnvironmentProject | null;
}) {
  const [choice, setSelected] = useState<string | null>(null);
  const selected = choice ?? (initialProject ? projectKey(initialProject) : "");
  const project = projects.find((entry) => projectKey(entry) === selected) ?? null;
  const fallback = project ?? projects[0];
  if (!fallback)
    return (
      <div className="p-4">
        <p className="mb-3 text-sm text-muted-foreground">Add a project to save this task.</p>
        <textarea
          aria-label="New task prompt"
          autoFocus
          defaultValue={link.prompt.text}
          className="min-h-80 w-full resize-y rounded-lg border border-border bg-transparent p-3 text-sm"
        />
      </div>
    );
  return (
    <CreateTaskDetail
      link={link}
      project={fallback}
      selected={selected}
      onSelect={setSelected}
      projects={projects}
    />
  );
}

function CreateTaskDetail({
  link,
  project,
  selected,
  onSelect,
  projects,
}: {
  link: NewTaskLink;
  project: EnvironmentProject;
  selected: string;
  onSelect: (value: string) => void;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  const { update } = useSavedPrompts(project.environmentId, project.id);
  const navigate = useNavigate();
  const [createdAt] = useState(() => new Date().toISOString());
  return (
    <div className="flex h-full min-h-0 flex-col">
      {link.prompt.hiddenCharacters > 0 ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          Hidden characters were removed from this link. Review the prompt before saving.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <TaskDetail
          task={{
            id: "new-task",
            text: link.prompt.text,
            title: link.title,
            status: "open",
            createdAt,
            completedAt: null,
          }}
          project={project}
          creationDisabled={selected === ""}
          projectControl={
            <Select value={selected} onValueChange={(value) => onSelect(value ?? "")}>
              <SelectTrigger size="compact" aria-label="Task project">
                <SelectValue placeholder="Choose project">
                  {(value: string) =>
                    projects.find((entry) => projectKey(entry) === value)?.title ?? "Choose project"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((entry) => (
                  <SelectItem key={projectKey(entry)} value={projectKey(entry)}>
                    {entry.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          onCreate={async ({ text, title }) => {
            if (!selected) return false;
            const ok = await update({ kind: "add", id: randomUUID(), text, title });
            if (ok)
              await navigate({
                to: "/tasks",
                search: { environment: project.environmentId, project: project.id },
              });
            return ok;
          }}
        />
      </div>
    </div>
  );
}
