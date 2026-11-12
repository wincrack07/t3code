import { createFileRoute } from "@tanstack/react-router";

import { TasksPage, type TasksSearch } from "../components/tasks/TasksPage";

function TasksRoute() {
  return <TasksPage search={Route.useSearch()} />;
}

export const Route = createFileRoute("/_chat/tasks/")({
  validateSearch: (search: Record<string, unknown>): TasksSearch => ({
    ...(typeof search.project === "string" ? { project: search.project } : {}),
    ...(typeof search.task === "string" ? { task: search.task } : {}),
  }),
  component: TasksRoute,
});
