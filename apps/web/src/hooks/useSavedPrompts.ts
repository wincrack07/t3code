import { randomUUID } from "../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  type EnvironmentId,
  type ProjectId,
  type SavedPromptAction,
} from "@t3tools/contracts";
import { environmentProjects, projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";

export function useSavedPrompts(environmentId: EnvironmentId, projectId: ProjectId) {
  const allowed = useAtomValue(projectEnvironment.savedPromptUpdate.permissionAtom(environmentId));
  const project = useAtomValue(environmentProjects.projectAtom({ environmentId, projectId }));
  const supported = project?.savedPrompts !== undefined;
  const run = useAtomCommand(projectEnvironment.savedPromptUpdate);
  return {
    allowed: allowed && supported,
    update: async (savedPrompt: SavedPromptAction) => {
      const result = await run({
        environmentId,
        input: {
          type: "project.update",
          projectId,
          commandId: CommandId.make(randomUUID()),
          savedPrompt,
        },
      });
      return result._tag === "Success";
    },
  };
}
