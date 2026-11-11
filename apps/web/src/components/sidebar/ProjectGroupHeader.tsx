import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ChevronDownIcon, FolderIcon, MoreHorizontalIcon } from "lucide-react";
import type { ProjectFolder } from "../../projectFolders";
import { summarizeSidebarFolder } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";

export function ProjectGroupHeader({
  folder,
  collapsed,
  threads,
  onToggle,
  onRename,
  onDelete,
}: {
  folder: ProjectFolder;
  collapsed: boolean;
  threads: readonly EnvironmentThreadShell[];
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const summary = summarizeSidebarFolder([{ hiddenThreads: threads }]);
  const dot = collapsed ? summary.activity : null;
  return (
    <li className="mt-2 flex list-none items-center gap-1">
      <button
        type="button"
        data-sidebar-row={`project-group:${folder.id}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover"
      >
        <ChevronDownIcon className={collapsed ? "size-3 -rotate-90" : "size-3"} />
        {folder.emoji ? <span>{folder.emoji}</span> : <FolderIcon className="size-4" />}
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
      <Menu>
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
          <MenuItem onClick={onRename}>Rename group</MenuItem>
          <MenuItem onClick={onDelete}>Delete group</MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}
