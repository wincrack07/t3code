import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { BookmarkIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { environmentProjects } from "../state/projects";
import { Button } from "./ui/button";

export function SavedPrompts({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const project = useAtomValue(environmentProjects.projectAtom({ environmentId, projectId }));
  const navigate = useNavigate();
  if (project?.savedPrompts === undefined) return null;
  const count = project.savedPrompts.filter((item) => item.completedAt === null).length;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Tasks (${count} open)`}
      onClick={() =>
        void navigate({ to: "/tasks", search: { environment: environmentId, project: projectId } })
      }
    >
      <BookmarkIcon />
      <span>{count}</span>
    </Button>
  );
}
