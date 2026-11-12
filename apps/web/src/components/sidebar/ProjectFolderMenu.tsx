import { projectFolderTree, type ProjectFolder } from "../../projectFolders";
import { MenuItem, MenuSub, MenuSubTrigger, MenuSubPopup } from "../ui/menu";
import { sidebarTreeIndent } from "./sidebarTreeDrag";

/** "Move to group" and "Move to top level" for a project or a group. */
export function ProjectFolderMenu({
  folders,
  currentFolderId,
  excludedFolderIds,
  onMove,
  onCreate,
}: {
  folders: readonly ProjectFolder[];
  currentFolderId: string | null;
  /** A group cannot move into itself or anything below it. */
  excludedFolderIds?: ReadonlySet<string>;
  onMove: (id: string | null) => void;
  onCreate?: () => void;
}) {
  const options = projectFolderTree(folders).filter(
    ({ folder }) => !excludedFolderIds?.has(folder.id),
  );
  return (
    <>
      {options.length > 0 || onCreate ? (
        <MenuSub>
          <MenuSubTrigger>Move to group</MenuSubTrigger>
          <MenuSubPopup>
            {options.map(({ folder, depth }) => (
              <MenuItem
                key={folder.id}
                disabled={folder.id === currentFolderId}
                onClick={() => onMove(folder.id)}
              >
                <span style={sidebarTreeIndent(depth)}>
                  {folder.emoji} {folder.name}
                </span>
              </MenuItem>
            ))}
            {onCreate ? <MenuItem onClick={onCreate}>New group…</MenuItem> : null}
          </MenuSubPopup>
        </MenuSub>
      ) : null}
      {currentFolderId !== null ? (
        <MenuItem onClick={() => onMove(null)}>Move to top level</MenuItem>
      ) : null}
    </>
  );
}
