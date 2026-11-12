import { useState } from "react";
import { SidebarColorMarker, SidebarColorSubmenu } from "./SidebarColorPicker";
import { updateClientSettings, getClientSettings } from "../../hooks/useSettings";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDownIcon, FolderIcon, MoreHorizontalIcon } from "lucide-react";
import type { ProjectFolder } from "../../projectFolders";
import { summarizeSidebarFolder } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "../ui/menu";
import { ProjectFolderMenu } from "./ProjectFolderMenu";
import {
  SIDEBAR_TREE_DROP_CLASS_NAME,
  sidebarTreeDragId,
  sidebarTreeIndent,
  sidebarTreeRow,
} from "./sidebarTreeDrag";

export function ProjectGroupHeader({
  folder,
  folders,
  depth = 0,
  parentId = null,
  excludedFolderIds,
  collapsed,
  threads,
  onToggle,
  onRename,
  onCreateInside,
  onMove,
  onDelete,
}: {
  folder: ProjectFolder;
  folders: readonly ProjectFolder[];
  depth?: number;
  parentId?: string | null;
  /** This group and every group below it. */
  excludedFolderIds: ReadonlySet<string>;
  collapsed: boolean;
  threads: readonly EnvironmentThreadShell[];
  onToggle: () => void;
  onRename: () => void;
  onCreateInside: () => void;
  onMove: (parentId: string | null) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const summary = summarizeSidebarFolder([{ hiddenThreads: threads }]);
  const dot = collapsed ? summary.activity : null;
  const item = { kind: "folder", id: folder.id } as const;
  const { setNodeRef, listeners } = useDraggable({ id: sidebarTreeDragId(item) });
  return (
    <li
      ref={setNodeRef}
      data-tree-row={sidebarTreeRow(item)}
      data-tree-expanded={!collapsed}
      style={sidebarTreeIndent(depth)}
      className={`mt-2 flex list-none items-center gap-1 ${SIDEBAR_TREE_DROP_CLASS_NAME}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        data-sidebar-row={`project-group:${folder.id}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
        {...listeners}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover"
      >
        <ChevronDownIcon className={collapsed ? "size-3 -rotate-90" : "size-3"} />
        {folder.emoji ? <span>{folder.emoji}</span> : <FolderIcon className="size-4" />}
        <SidebarColorMarker color={folder.sidebarColor} />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {collapsed ? (
          <>
            <span className="sr-only">
              {dot === "attention" ? "Needs you" : dot === "working" ? "Working" : (dot ?? "")}
            </span>
            {dot ? (
              <span
                aria-hidden
                className={
                  {
                    attention: "size-1.5 rounded-full bg-warning",
                    failed: "size-1.5 rounded-full bg-error",
                    unread: "size-1.5 rounded-full bg-success",
                    working: "size-1.5 rounded-full bg-info",
                  }[dot]
                }
              />
            ) : null}
            <span className="tabular-nums">{summary.openThreadCount}</span>
          </>
        ) : null}
      </button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Group actions for ${folder.name}`}
            />
          }
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup>
          <SidebarColorSubmenu
            value={folder.sidebarColor ?? null}
            onChange={(color) =>
              void updateClientSettings({
                sidebarProjectFolders: getClientSettings().sidebarProjectFolders.map((entry) =>
                  entry.id === folder.id ? { ...entry, sidebarColor: color } : entry,
                ),
              })
            }
          />
          <MenuItem onClick={onRename}>Rename group</MenuItem>
          <MenuItem onClick={onCreateInside}>New group inside…</MenuItem>
          <ProjectFolderMenu
            folders={folders}
            currentFolderId={parentId}
            excludedFolderIds={excludedFolderIds}
            onMove={onMove}
          />
          <MenuSeparator />
          <MenuItem onClick={onDelete}>Delete group</MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}
