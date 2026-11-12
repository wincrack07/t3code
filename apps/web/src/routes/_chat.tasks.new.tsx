import { createFileRoute, useLocation } from "@tanstack/react-router";
import { parseNewTaskLink } from "@t3tools/shared/promptLinks";
import { TasksPage } from "../components/tasks/TasksPage";
import { SidebarInset } from "../components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";

function NewTaskLinkRoute() {
  const search = useLocation({ select: (location) => location.searchStr });
  const parsed = parseNewTaskLink(search);
  if (!parsed.ok)
    return (
      <SidebarInset className="h-dvh">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Could not open the link</EmptyTitle>
            <EmptyDescription>{parsed.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  return <TasksPage key={search} newTask={parsed.value} />;
}

export const Route = createFileRoute("/_chat/tasks/new")({ component: NewTaskLinkRoute });
