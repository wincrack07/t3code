import type { ProjectSavedPrompt } from "@t3tools/contracts";

export const taskStatus = (task: ProjectSavedPrompt) =>
  task.status ?? (task.completedAt === null ? "open" : "done");
export const taskTitle = (task: ProjectSavedPrompt) =>
  task.title ?? task.text.split("\n")[0]?.slice(0, 160) ?? "Untitled task";
export const taskThreadRunning = (status: string | undefined) =>
  status !== undefined &&
  ["preparing", "queued", "starting", "running", "waiting"].includes(status);
