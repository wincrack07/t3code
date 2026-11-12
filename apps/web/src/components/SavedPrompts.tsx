import { useAtomValue } from "@effect/atom-react";
import { environmentProjects } from "../state/projects";
import { useState } from "react";
import { BookmarkIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentId, ProjectId, ProjectSavedPrompt } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useSavedPrompts } from "../hooks/useSavedPrompts";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../composerDraftStore";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription, DialogHeader } from "./ui/dialog";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";

export function SavedPrompts({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const project = useAtomValue(environmentProjects.projectAtom({ environmentId, projectId }));
  const items = project?.savedPrompts ?? [];
  const [open, setOpen] = useState(false);
  const activeCount = items.filter((item) => item.completedAt === null).length;
  if (project?.savedPrompts === undefined) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Saved prompts (${activeCount} open)`}
        onClick={() => setOpen(true)}
      >
        <BookmarkIcon />
        <span>{activeCount}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <SavedPromptsDialog
            environmentId={environmentId}
            projectId={projectId}
            title={project?.title ?? "Project"}
            items={items}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function SavedPromptsDialog({
  environmentId,
  projectId,
  title,
  items,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title: string;
  items: ReadonlyArray<ProjectSavedPrompt>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { allowed, update } = useSavedPrompts(environmentId, projectId);
  const context = useHandleNewThread();
  const restoreItem = async (item: ProjectSavedPrompt, newThread: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const current = context.activeThread ?? context.activeDraftThread;
      const target = context.routeDraftId ?? context.routeThreadRef;
      if (
        !newThread &&
        target &&
        current?.projectId === projectId &&
        current.environmentId === environmentId
      ) {
        const store = useComposerDraftStore.getState();
        const draft = store.getComposerDraft(target);
        store.setPrompt(target, [draft?.prompt, item.text].filter(Boolean).join("\n\n"));
      } else {
        const result = await context.handleNewThread(scopeProjectRef(environmentId, projectId));
        if (!result) {
          setBusy(false);
          return;
        }
        const store = useComposerDraftStore.getState();
        const draft = store.getComposerDraft(result.draftId);
        store.setPrompt(result.draftId, [draft?.prompt, item.text].filter(Boolean).join("\n\n"));
      }
      if (await update({ kind: "complete", id: item.id, done: true })) onClose();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not use saved prompt",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
    setBusy(false);
  };
  const renderItem = (item: ProjectSavedPrompt) => (
    <SavedPromptRow
      key={item.id}
      item={item}
      disabled={!allowed || busy}
      onEdit={(text) => update({ kind: "edit", id: item.id, text })}
      onComplete={() => update({ kind: "complete", id: item.id, done: item.completedAt === null })}
      onDelete={() => update({ kind: "delete", id: item.id })}
      onUse={(newThread) => void restoreItem(item, newThread)}
    />
  );
  const active = items.filter((item) => item.completedAt === null);
  const done = items.filter((item) => item.completedAt !== null);
  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Saved prompts</DialogTitle>
        <DialogDescription>{title} · Text saved for later</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto px-6 pb-4">
        {active.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            No open prompts. Save a draft from the composer.
          </p>
        ) : (
          active.map(renderItem)
        )}
        {done.length > 0 ? (
          <details>
            <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
              Done ({done.length})
            </summary>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!allowed || busy}
              onClick={() => void update({ kind: "clear-done" })}
            >
              Clear done
            </Button>
            {done.map(renderItem)}
          </details>
        ) : null}
      </div>
    </DialogPopup>
  );
}
function SavedPromptRow({
  item,
  disabled,
  onEdit,
  onComplete,
  onDelete,
  onUse,
}: {
  item: ProjectSavedPrompt;
  disabled: boolean;
  onEdit: (text: string) => Promise<boolean>;
  onComplete: () => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onUse: (newThread: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(item.text);
  return (
    <div className="rounded-lg text-sm hover:bg-accent/40">
      <div className="flex h-8 items-center gap-2 px-2">
        <Checkbox
          aria-label={item.completedAt === null ? "Mark prompt done" : "Mark prompt not done"}
          checked={item.completedAt !== null}
          disabled={disabled}
          onCheckedChange={() => void onComplete()}
        />
        <button
          type="button"
          aria-expanded={expanded}
          className="min-w-0 flex-1 cursor-pointer truncate text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {item.text.split("\n")[0]?.slice(0, 160)}
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.createdAt} />
            }
          >
            {new Date(item.createdAt).toLocaleDateString()}
          </TooltipTrigger>
          <TooltipPopup>{new Date(item.createdAt).toLocaleString()}</TooltipPopup>
        </Tooltip>
      </div>
      {expanded ? (
        <div className="px-2 pb-2">
          {editing ? (
            <Textarea
              aria-label="Edit saved prompt"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words py-2">{item.text}</p>
          )}
          <div className="flex items-center justify-end gap-1">
            {editing ? (
              <>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || !text.trim()}
                  onClick={async () => {
                    if (await onEdit(text.trim())) setEditing(false);
                  }}
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setText(item.text);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onUse(false)}
                >
                  Use
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onUse(true)}
                >
                  Start thread
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete saved prompt"
                  disabled={disabled}
                  onClick={() => void onDelete()}
                >
                  <Trash2Icon />
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
