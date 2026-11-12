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
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { cloneComposerImageForRetry } from "../ChatView.logic";
import { prepareTurnAttachments } from "./chatViewSend";
import { taskAttachmentLimitError } from "../tasks/tasks.logic";

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
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(target);
    const images = draft?.images ?? [];
    const files = draft?.files ?? [];
    const fail = (description: string) =>
      toastManager.add({ type: "error", title: "Could not save prompt", description });
    const limit = taskAttachmentLimitError(
      [],
      [...images, ...files].map((item) => ({
        name: item.name,
        kind: item.type,
        sizeBytes: item.sizeBytes,
      })),
    );
    if (limit) return fail(limit);
    // Uploads live on the composer's machine; a task stored elsewhere takes images inline.
    const sameMachine = homeEnvironmentId === environmentId;
    if (!sameMachine && files.length > 0) {
      return fail(
        `Files in this draft were uploaded to ${labelOf(environmentId)}. Save it from a composer on ${labelOf(homeEnvironmentId)}, or remove the files.`,
      );
    }
    setBusy(true);
    const id = randomUUID();
    const attachments = await prepareTurnAttachments({
      environmentId,
      attachments: [...images, ...files],
      usesAttachmentUploads:
        sameMachine && appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId),
    }).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : "Try again.");
      return null;
    });
    if (!attachments) {
      setBusy(false);
      return;
    }
    const saved = await update({
      kind: "add",
      id,
      text: replaceComposerContextReferences(text, (reference) => reference.label).trim(),
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((attachment) => ({ kind: "upload" as const, attachment })),
          }
        : {}),
    });
    setBusy(false);
    if (!saved) return;
    if (store.getComposerDraft(target)?.prompt === text) {
      // The task holds its own copies, so the draft's uploads stay put for Undo.
      store.clearComposerPromptAndImages(target);
    }
    const count = attachments.length;
    toastManager.add({
      type: "success",
      title: "Prompt saved for later",
      description: `Saved to Tasks on ${labelOf(homeEnvironmentId)}${
        count > 0 ? ` with ${count} ${count === 1 ? "attachment" : "attachments"}` : ""
      }.`,
      actionProps: {
        children: "Undo",
        onClick: async () => {
          if (!(await update({ kind: "delete", id }))) return;
          const current = store.getComposerDraft(target)?.prompt;
          store.setPrompt(target, [current, text].filter(Boolean).join("\n\n"));
          store.addImages(target, images.map(cloneComposerImageForRetry));
          store.addFiles(target, files);
        },
      },
    });
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
