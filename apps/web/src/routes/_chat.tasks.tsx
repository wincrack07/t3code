import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "../components/tasks/TasksPage";

export const Route = createFileRoute("/_chat/tasks")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { environment?: string; project?: string } => ({
    ...(typeof search.environment === "string" ? { environment: search.environment } : {}),
    ...(typeof search.project === "string" ? { project: search.project } : {}),
  }),
  component: TasksPage,
});
