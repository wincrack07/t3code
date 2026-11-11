import type { ProjectFolder } from "../../projectFolders";
import { MenuItem, MenuSub, MenuSubTrigger, MenuSubPopup } from "../ui/menu";

export function ProjectFolderMenu({
  folders,
  assigned,
  onMove,
  onCreate,
}: {
  folders: readonly ProjectFolder[];
  assigned: boolean;
  onMove: (id: string | null) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <MenuSub>
        <MenuSubTrigger>Move to group</MenuSubTrigger>
        <MenuSubPopup>
          {folders.map((folder) => (
            <MenuItem key={folder.id} onClick={() => onMove(folder.id)}>
              {folder.emoji} {folder.name}
            </MenuItem>
          ))}
          <MenuItem onClick={onCreate}>New group…</MenuItem>
        </MenuSubPopup>
      </MenuSub>
      {assigned ? <MenuItem onClick={() => onMove(null)}>Remove from group</MenuItem> : null}
    </>
  );
}
