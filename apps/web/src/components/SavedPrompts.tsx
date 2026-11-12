import { useNavigate } from "@tanstack/react-router";
import { BookmarkIcon } from "lucide-react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "../rightPanelStore";

import { findTaskGroupForProject, openTaskCount } from "./tasks/tasks.logic";
import { useTaskProjectGroups } from "./tasks/useTaskProjects";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** The open-task count of the chat's logical project, the same on every machine that has it. */
export function SavedPrompts({
  environmentId,
  projectId,
  threadRef,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Opens the quick panel beside this chat; without one the count opens the Tasks page. */
  threadRef: ScopedThreadRef | null;
}) {
  const group = findTaskGroupForProject(useTaskProjectGroups(), environmentId, projectId);
  const navigate = useNavigate();
  if (!group?.members.some((member) => member.project.savedPrompts !== undefined)) return null;
  const count = openTaskCount(group);
  const label =
    group.unreachable > 0
      ? `${count} open tasks · ${group.unreachable} ${group.unreachable === 1 ? "machine" : "machines"} not reachable`
      : `${count} open ${count === 1 ? "task" : "tasks"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            onClick={() => {
              if (threadRef) useRightPanelStore.getState().open(threadRef, "tasks");
              else void navigate({ to: "/tasks", search: { project: group.key } });
            }}
          />
        }
      >
        <BookmarkIcon />
        <span className="tabular-nums">{count}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
