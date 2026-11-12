import type { SidebarTreeDragItem } from "../../projectFolders";

const TREE_DRAG_PREFIX = "tree:";

export function sidebarTreeDragId(item: SidebarTreeDragItem): string {
  return item.kind === "folder"
    ? `${TREE_DRAG_PREFIX}folder:${item.id}`
    : `${TREE_DRAG_PREFIX}project:${item.key}`;
}

export function parseSidebarTreeDragId(id: string): SidebarTreeDragItem | null {
  if (!id.startsWith(TREE_DRAG_PREFIX)) return null;
  return parseSidebarTreeRow(id.slice(TREE_DRAG_PREFIX.length));
}

/** Value of `data-tree-row`, which marks the rows a group or project drag can land on. */
export function sidebarTreeRow(item: SidebarTreeDragItem): string {
  return item.kind === "folder" ? `folder:${item.id}` : `project:${item.key}`;
}

export function parseSidebarTreeRow(row: string): SidebarTreeDragItem | null {
  if (row.startsWith("folder:")) return { kind: "folder", id: row.slice("folder:".length) };
  if (row.startsWith("project:")) return { kind: "project", key: row.slice("project:".length) };
  return null;
}

// Drag state lives in DOM attributes so moving the pointer never re-renders the list.
export const SIDEBAR_TREE_DROP_CLASS_NAME = [
  "relative data-tree-dragging:opacity-50",
  "data-[tree-drop=into]:rounded-(--control-radius) data-[tree-drop=into]:bg-sidebar-row-hover data-[tree-drop=into]:ring-1 data-[tree-drop=into]:ring-inset data-[tree-drop=into]:ring-ring",
  "data-[tree-drop=before]:before:pointer-events-none data-[tree-drop=before]:before:absolute data-[tree-drop=before]:before:inset-x-2 data-[tree-drop=before]:before:-top-px data-[tree-drop=before]:before:h-0.5 data-[tree-drop=before]:before:rounded-full data-[tree-drop=before]:before:bg-primary data-[tree-drop=before]:before:content-['']",
  "data-[tree-drop=after]:after:pointer-events-none data-[tree-drop=after]:after:absolute data-[tree-drop=after]:after:inset-x-2 data-[tree-drop=after]:after:-bottom-px data-[tree-drop=after]:after:h-0.5 data-[tree-drop=after]:after:rounded-full data-[tree-drop=after]:after:bg-primary data-[tree-drop=after]:after:content-['']",
].join(" ");

/** Indents a tree row by its nesting depth. */
export function sidebarTreeIndent(depth: number) {
  return depth > 0 ? { marginInlineStart: `${depth}rem` } : undefined;
}
