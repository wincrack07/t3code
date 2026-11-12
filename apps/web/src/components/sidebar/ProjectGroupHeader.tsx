import { useState } from "react";
import { SidebarColorSubmenu } from "./SidebarColorPicker";
import { updateClientSettings, getClientSettings } from "../../hooks/useSettings";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDownIcon, FolderIcon, MoreHorizontalIcon } from "lucide-react";
import { projectFolderColor, type ProjectFolder } from "../../projectFolders";
import { sidebarRowColorStyle } from "../../sidebarColors";
import { cn } from "~/lib/utils";
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

const GROUP_DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
} as const;

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
  const rowColor = projectFolderColor(folders, folder.id);
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
      data-sidebar-group-header=""
      data-sidebar-row-colour={rowColor ?? undefined}
      style={{ ...sidebarTreeIndent(depth), ...sidebarRowColorStyle(rowColor) }}
      className={cn("group/project-group list-none", SIDEBAR_TREE_DROP_CLASS_NAME)}
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
        className="flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {folder.emoji || <FolderIcon aria-hidden className="size-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {collapsed ? (
          <>
            <span className="sr-only">
              {dot === "attention" ? "Needs you" : dot === "working" ? "Working" : (dot ?? "")}
            </span>
            {dot ? (
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", GROUP_DOT_CLASS_NAME[dot])}
              />
            ) : null}
            <span
              className={cn(
                "shrink-0 tabular-nums group-hover/project-group:invisible pointer-coarse:invisible",
                menuOpen && "invisible",
              )}
            >
              {summary.openThreadCount}
            </span>
          </>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        {/* Sits over the count, which hides on hover, and left of the chevron. */}
        <span
          className={cn(
            "absolute inset-y-0 right-6 flex items-center opacity-0 focus-within:opacity-100 group-hover/project-group:opacity-100 pointer-coarse:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Group actions for ${folder.name}`}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden />
          </MenuTrigger>
        </span>
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
