import { SidebarColorPicker } from "./SidebarColorPicker";
import { randomUUID } from "../../lib/utils";
import { useState } from "react";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  moveProjectsToFolder,
  suggestProjectFolders,
  type ProjectFolder,
} from "../../projectFolders";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

export function ProjectFolderEditor({
  folder,
  parentId,
  projectKeys = [],
  onClose,
}: {
  folder?: ProjectFolder;
  /** Creates the new group inside this one. */
  parentId?: string;
  projectKeys?: readonly string[];
  onClose: () => void;
}) {
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const update = useUpdatePrimarySettings();
  const [name, setName] = useState(folder?.name ?? "");
  const [sidebarColor, setSidebarColor] = useState(folder?.sidebarColor ?? null);
  const [emoji, setEmoji] = useState(folder?.emoji ?? "");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {folder
              ? "Rename group"
              : parentId
                ? `New group inside ${folders.find((entry) => entry.id === parentId)?.name ?? "group"}`
                : "New project group"}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-2 text-sm">
            Name
            <Input
              aria-label="Group name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label className="block space-y-2 text-sm">
            Emoji (optional)
            <Input
              aria-label="Group emoji"
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
            />
          </label>
          <SidebarColorPicker value={sidebarColor} onChange={setSidebarColor} />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              const next: ProjectFolder = {
                ...folder,
                id: folder?.id ?? randomUUID(),
                name: name.trim(),
                emoji: emoji.trim(),
                sidebarColor,
                projectKeys: folder?.projectKeys ?? [],
                ...(parentId === undefined ? {} : { parentId }),
              };
              const updated = folder
                ? folders.map((entry) => (entry.id === folder.id ? next : entry))
                : [...folders, next];
              update({
                sidebarThreadGrouping: "project",
                sidebarProjectFolders: moveProjectsToFolder(updated, projectKeys, next.id),
              });
              onClose();
            }}
          >
            Save group
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ProjectFolderSuggestions({
  projects,
  onClose,
}: {
  projects: readonly SidebarProjectSnapshot[];
  onClose: () => void;
}) {
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const update = useUpdatePrimarySettings();
  const suggestions = suggestProjectFolders(projects, folders);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Suggested project groups</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {suggestions.length === 0 ? (
            <p>No shared name prefixes found among ungrouped projects.</p>
          ) : (
            suggestions.map((entry) => (
              <div key={entry.name} className="space-y-1 text-sm">
                <strong>{entry.name}</strong>
                <p className="text-muted-foreground">
                  {entry.projectKeys
                    .map(
                      (key) => projects.find((project) => project.projectKey === key)?.displayName,
                    )
                    .join(", ")}
                </p>
              </div>
            ))
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={suggestions.length === 0}
            onClick={() => {
              update({
                sidebarThreadGrouping: "project",
                sidebarProjectFolders: [
                  ...folders,
                  ...suggestions.map((entry) => ({ ...entry, id: randomUUID(), emoji: "" })),
                ],
              });
              onClose();
            }}
          >
            Create suggested groups
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
