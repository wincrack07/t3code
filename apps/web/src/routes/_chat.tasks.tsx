import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { TasksPage } from "../components/tasks/TasksPage";

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { environment?: string; project?: string } => ({
    ...(typeof search.environment === "string" ? { environment: search.environment } : {}),
    ...(typeof search.project === "string" ? { project: search.project } : {}),
  }),
  component: TasksRoute,
});

function TasksRoute() {
  const child = useLocation({ select: (location) => location.pathname === "/tasks/new" });
  return child ? <Outlet /> : <TasksPage />;
}
