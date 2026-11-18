import { SidebarColorPicker } from "./SidebarColorPicker";
import { randomUUID } from "../../lib/utils";
import { T, useGT } from "gt-react";
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
  const gt = useGT();
  const parentName = parentId ? folders.find((entry) => entry.id === parentId)?.name : undefined;
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
              ? gt("Rename group")
              : parentName
                ? gt("New group inside {name}", { name: parentName })
                : parentId
                  ? gt("New group inside a group")
                  : gt("New project group")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-2 text-sm">
            <T>Name</T>
            <Input
              aria-label={gt("Group name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label className="block space-y-2 text-sm">
            <T>Emoji (optional)</T>
            <Input
              aria-label={gt("Group emoji")}
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
            />
          </label>
          <SidebarColorPicker value={sidebarColor} onChange={setSidebarColor} />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <T>Cancel</T>
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
            <T>Save group</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
