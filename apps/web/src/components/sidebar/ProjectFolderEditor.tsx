import { SidebarColorPicker } from "./SidebarColorPicker";
import { randomUUID } from "../../lib/utils";
import { useState } from "react";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { moveProjectsToFolder, type ProjectFolder } from "../../projectFolders";
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
