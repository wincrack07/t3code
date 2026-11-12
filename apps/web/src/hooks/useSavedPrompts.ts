import { randomUUID } from "../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
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
  const runQuietly = useAtomCommand(projectEnvironment.savedPromptUpdate, { reportFailure: false });
  const input = (savedPrompt: SavedPromptAction) => ({
    environmentId,
    input: {
      type: "project.update" as const,
      projectId,
      commandId: CommandId.make(randomUUID()),
      savedPrompt,
    },
  });
  return {
    allowed: allowed && supported,
    update: async (savedPrompt: SavedPromptAction) =>
      (await run(input(savedPrompt)))._tag === "Success",
    /** Like `update`, but returns the server's refusal for the caller to show in place. */
    attempt: async (savedPrompt: SavedPromptAction): Promise<string | null> => {
      const result = await runQuietly(input(savedPrompt));
      if (result._tag === "Success") return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error && error.message ? error.message : "Could not save. Try again.";
    },
  };
}
