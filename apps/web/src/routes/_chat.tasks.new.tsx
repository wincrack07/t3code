import { findPromptLinkProjects } from "@t3tools/client-runtime/prompt-links";
import { parseNewTaskLink } from "@t3tools/shared/promptLinks";
import { createFileRoute, useLocation } from "@tanstack/react-router";

import { TasksPage } from "../components/tasks/TasksPage";
import { findTaskGroupForProject } from "../components/tasks/tasks.logic";
import { useTaskProjectGroups } from "../components/tasks/useTaskProjects";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useProjects } from "../state/entities";

// The query is read raw, like /new: the router's own search parsing turns `prompt=123` into a number.
function NewTaskLinkRoute() {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const groups = useTaskProjectGroups();
  const projects = useProjects();
  const params = new URLSearchParams(searchStr);
  const project = params.get("project") ?? undefined;
  // "New task" opens an empty draft; a link carries its prompt.
  const parsed =
    params.has("prompt") || params.has("title") || params.has("repo")
      ? parseNewTaskLink(searchStr)
      : ({
          ok: true,
          value: { prompt: { text: "", hiddenCharacters: 0 }, title: null, repository: null },
        } as const);
  if (!parsed.ok) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle>Could not open the link</EmptyTitle>
            <EmptyDescription>{parsed.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  const { repository } = parsed.value;
  const linked = repository ? findPromptLinkProjects(projects, repository)[0] : undefined;
  const projectKey = linked
    ? (findTaskGroupForProject(groups, linked.environmentId, linked.id)?.key ?? null)
    : (project ?? null);
  return (
    <TasksPage
      key={searchStr}
      search={project ? { project } : {}}
      draft={{ prompt: parsed.value.prompt.text, title: parsed.value.title, projectKey }}
    />
  );
}

export const Route = createFileRoute("/_chat/tasks/new")({
  component: NewTaskLinkRoute,
});
