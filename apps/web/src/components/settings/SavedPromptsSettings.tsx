import { useState } from "react";
import {
  MAX_SAVED_PROMPT_LENGTH,
  MAX_SAVED_PROMPT_NAME_LENGTH,
  MAX_SAVED_PROMPTS,
  type SavedPrompt,
} from "@t3tools/contracts/settings";
import { PencilIcon, PlusIcon, XIcon } from "lucide-react";

import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type Draft = { readonly id: string | null; readonly name: string; readonly prompt: string };

/** Edits the prompts the composer's / menu inserts. */
export function SavedPromptsRow() {
  const savedPrompts = useScopedSettings((settings) => settings.savedPrompts);
  const updateSettings = useUpdateScopedSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const name = draft?.name.trim() ?? "";
  const canSave = name.length > 0 && (draft?.prompt.trim().length ?? 0) > 0;

  const save = () => {
    if (!draft || !canSave) return;
    const next: SavedPrompt = {
      id: draft.id ?? randomUUID(),
      name,
      prompt: draft.prompt,
    };
    updateSettings({
      savedPrompts:
        draft.id === null
          ? [...savedPrompts, next]
          : savedPrompts.map((entry) => (entry.id === draft.id ? next : entry)),
    });
    setDraft(null);
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={["savedPrompts"]}
      {...searchableSetting("saved-prompts")}
      description="Reusable prompts. Type / in the composer and pick one to insert it."
    >
      <div className="flex flex-col gap-1.5 pt-3 pb-2">
        {savedPrompts.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <span className="min-w-0 max-w-[40%] shrink-0 truncate text-sm">{entry.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {entry.prompt.trim().split("\n", 1)[0]}
            </span>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={`Edit ${entry.name}`}
              onClick={() => setDraft(entry)}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={`Remove ${entry.name}`}
              onClick={() =>
                updateSettings({
                  savedPrompts: savedPrompts.filter((candidate) => candidate.id !== entry.id),
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="ghost-muted"
            size="compact"
            disabled={savedPrompts.length >= MAX_SAVED_PROMPTS}
            onClick={() => setDraft({ id: null, name: "", prompt: "" })}
          >
            <PlusIcon />
            Add prompt
          </Button>
        </div>
      </div>
      <Dialog open={draft !== null} onOpenChange={(open) => (open ? undefined : setDraft(null))}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit prompt" : "Add prompt"}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="saved-prompt-name">Name</Label>
                <Input
                  id="saved-prompt-name"
                  placeholder="Review my changes"
                  maxLength={MAX_SAVED_PROMPT_NAME_LENGTH}
                  value={draft?.name ?? ""}
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, name: event.target.value })
                  }
                  autoFocus
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="saved-prompt-text">Prompt</Label>
                <Textarea
                  id="saved-prompt-text"
                  rows={8}
                  maxLength={MAX_SAVED_PROMPT_LENGTH}
                  value={draft?.prompt ?? ""}
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, prompt: event.target.value })
                  }
                />
              </div>
            </form>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsRow>
  );
}
