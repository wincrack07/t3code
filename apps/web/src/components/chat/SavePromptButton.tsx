import { randomUUID } from "../../lib/utils";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { BackgroundThreadContext } from "./backgroundThread";
import { isInSideChatPane } from "../../lib/sideChatPane";
import { use, useEffect, useState } from "react";
import { BookmarkPlusIcon } from "lucide-react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useSavedPrompts } from "../../hooks/useSavedPrompts";
import { useStableCallback } from "../../hooks/useStableCallback";
import { registerCommands } from "../../shortcuts/dispatcher";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { findTaskGroupForProject, pickTaskHomeProject } from "../tasks/tasks.logic";
import { useEnvironmentLabel, useTaskProjectGroups } from "../tasks/useTaskProjects";
import { usePrimaryEnvironmentId } from "../../state/environments";

export const SAVE_PROMPT_EVENT = "t3:save-prompt";

export function SavePromptButton({
  environmentId,
  projectId,
  target,
  text,
  automaticEnvironment = false,
  disabled,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  target: ScopedThreadRef | DraftId;
  text: string;
  automaticEnvironment?: boolean;
  disabled: boolean;
}) {
  const groups = useTaskProjectGroups();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const labelOf = useEnvironmentLabel();
  const group = automaticEnvironment
    ? findTaskGroupForProject(groups, environmentId, projectId)
    : null;
  // Auto balance has not settled on a machine, so the task goes where Tasks stores new ones.
  const home = group ? pickTaskHomeProject(group, primaryEnvironmentId, labelOf) : null;
  const homeEnvironmentId = home?.environmentId ?? environmentId;
  const { allowed, update } = useSavedPrompts(homeEnvironmentId, home?.id ?? projectId);
  const [busy, setBusy] = useState(false);
  const backgroundThread = use(BackgroundThreadContext);
  const save = useStableCallback(async () => {
    if (!allowed || disabled || busy || !text.trim()) return;
    setBusy(true);
    const id = randomUUID();
    try {
      if (
        !(await update({
          kind: "add",
          id,
          text: replaceComposerContextReferences(text, (reference) => reference.label).trim(),
        }))
      ) {
        setBusy(false);
        return;
      }
      const store = useComposerDraftStore.getState();
      if (store.getComposerDraft(target)?.prompt === text) store.setPrompt(target, "");
      toastManager.add({
        type: "success",
        title: "Prompt saved for later",
        description: `Saved to Tasks on ${labelOf(homeEnvironmentId)}. Text only; attachments stay in the composer.`,
        actionProps: {
          children: "Undo",
          onClick: async () => {
            if (await update({ kind: "delete", id })) {
              const current = store.getComposerDraft(target)?.prompt;
              store.setPrompt(target, [current, text].filter(Boolean).join("\n\n"));
            }
          },
        },
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save prompt",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
    setBusy(false);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the composer shortcut and command palette action while this composer is mounted
  useEffect(() => {
    if (backgroundThread) return;
    const off = registerCommands(
      {
        "composer.saveForLater": (event) => {
          event.preventDefault();
          void save();
        },
      },
      { when: (event) => !isInSideChatPane(event.target) },
    );
    const run = () => void save();
    window.addEventListener(SAVE_PROMPT_EVENT, run);
    return () => {
      off();
      window.removeEventListener(SAVE_PROMPT_EVENT, run);
    };
  }, [save, backgroundThread]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Save for later"
            disabled={disabled || busy || !allowed || !text.trim()}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void save()}
          >
            <BookmarkPlusIcon />
          </Button>
        }
      />
      <TooltipPopup>Save for later</TooltipPopup>
    </Tooltip>
  );
}
