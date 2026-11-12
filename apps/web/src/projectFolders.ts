import type { ClientSettings } from "@t3tools/contracts";

export const UNGROUPED_PROJECT_FOLDER_ID = "ungrouped";

export type ProjectFolder = ClientSettings["sidebarProjectFolders"][number];

export function moveProjectsToFolder(
  folders: readonly ProjectFolder[],
  projectKeys: readonly string[],
  folderId: string | null,
): ProjectFolder[] {
  if (folderId !== null && !folders.some((folder) => folder.id === folderId)) return [...folders];
  const keys = new Set(projectKeys);
  return folders.map((folder) => ({
    ...folder,
    projectKeys: [
      ...folder.projectKeys.filter((key) => !keys.has(key)),
      ...(folder.id === folderId ? [...keys] : []),
    ],
  }));
}

export function suggestProjectFolders(
  projects: readonly { projectKey: string; displayName: string }[],
  folders: readonly ProjectFolder[],
) {
  const assigned = new Set(folders.flatMap((folder) => folder.projectKeys));
  const prefixes = new Map<string, { name: string; projectKeys: string[] }>();
  for (const project of projects) {
    if (assigned.has(project.projectKey)) continue;
    const match = /^(.+?)(?:\s*[:·]\s*|\s+-\s+)\S/.exec(project.displayName);
    const name = match?.[1]?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const entry = prefixes.get(key) ?? { name, projectKeys: [] };
    entry.projectKeys.push(project.projectKey);
    prefixes.set(key, entry);
  }
  return [...prefixes.values()].filter((entry) => entry.projectKeys.length > 1);
}

export const projectFolderExpansionKey = (folderId: string) => `project-group:${folderId}`;

/** Parents that are missing or would close a cycle read as top level, so no group is lost. */
function resolveProjectFolderParents(folders: readonly ProjectFolder[]) {
  const ids = new Set(folders.map((folder) => folder.id));
  const parents = new Map<string, string | null>();
  for (const folder of folders) {
    const parentId = folder.parentId;
    parents.set(folder.id, parentId !== undefined && ids.has(parentId) ? parentId : null);
  }
  for (const folder of folders) {
    const seen = new Set<string>();
    for (let id: string | null = folder.id; id !== null; id = parents.get(id) ?? null) {
      if (seen.has(id)) {
        parents.set(folder.id, null);
        break;
      }
      seen.add(id);
    }
  }
  return parents;
}

/** Nearest first. */
export function projectFolderAncestors(
  folders: readonly ProjectFolder[],
  folderId: string,
): string[] {
  const parents = resolveProjectFolderParents(folders);
  const ancestors: string[] = [];
  for (let id = parents.get(folderId) ?? null; id !== null; id = parents.get(id) ?? null) {
    ancestors.push(id);
  }
  return ancestors;
}

export function projectFolderColor(
  folders: readonly ProjectFolder[],
  folderId: string | undefined,
): string | null {
  if (folderId === undefined) return null;
  for (const id of [folderId, ...projectFolderAncestors(folders, folderId)]) {
    const color = folders.find((folder) => folder.id === id)?.sidebarColor;
    if (color) return color;
  }
  return null;
}

export function projectFolderPath(folders: readonly ProjectFolder[], folderId: string): string {
  return [...projectFolderAncestors(folders, folderId).toReversed(), folderId]
    .map((id) => folders.find((folder) => folder.id === id)?.name ?? "")
    .join(" / ");
}

export function projectFolderOfProject(
  folders: readonly ProjectFolder[],
  projectKey: string,
): ProjectFolder | undefined {
  return folders.find((folder) => folder.projectKeys.includes(projectKey));
}

/** Every group in display order: depth first, stored order among siblings. */
export function projectFolderTree(
  folders: readonly ProjectFolder[],
): { folder: ProjectFolder; depth: number }[] {
  const parents = resolveProjectFolderParents(folders);
  const rows: { folder: ProjectFolder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of folders) {
      if ((parents.get(folder.id) ?? null) !== parentId) continue;
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

function withParent(folder: ProjectFolder, parentId: string | null): ProjectFolder {
  const { parentId: _previous, ...rest } = folder;
  return parentId === null ? rest : { ...rest, parentId };
}

export type ProjectFolderPlacement = {
  parentId: string | null;
  before?: string;
  after?: string;
};

export function moveProjectFolder(
  folders: readonly ProjectFolder[],
  folderId: string,
  to: ProjectFolderPlacement,
): ProjectFolder[] {
  const moving = folders.find((folder) => folder.id === folderId);
  if (!moving) return [...folders];
  if (to.parentId !== null) {
    if (!folders.some((folder) => folder.id === to.parentId)) return [...folders];
    if (to.parentId === folderId || projectFolderAncestors(folders, to.parentId).includes(folderId))
      return [...folders];
  }
  const rest = folders.filter((folder) => folder.id !== folderId);
  const anchor = to.before ?? to.after;
  const anchorIndex = anchor === undefined ? -1 : rest.findIndex((folder) => folder.id === anchor);
  const index =
    anchorIndex < 0 ? rest.length : to.before !== undefined ? anchorIndex : anchorIndex + 1;
  rest.splice(index, 0, withParent(moving, to.parentId));
  return rest;
}

/** Children take the deleted group's place under its parent; its projects join that parent. */
export function deleteProjectFolder(
  folders: readonly ProjectFolder[],
  folderId: string,
): ProjectFolder[] {
  const parents = resolveProjectFolderParents(folders);
  const deleted = folders.find((folder) => folder.id === folderId);
  if (!deleted) return [...folders];
  const parentId = parents.get(folderId) ?? null;
  const children = folders.filter((folder) => parents.get(folder.id) === folderId);
  return folders.flatMap((folder) => {
    if (folder.id === folderId) return children.map((child) => withParent(child, parentId));
    if (parents.get(folder.id) === folderId) return [];
    if (folder.id === parentId)
      return [{ ...folder, projectKeys: [...folder.projectKeys, ...deleted.projectKeys] }];
    return [folder];
  });
}

export type ProjectFolderTreeRow<T> =
  | { kind: "project"; project: T; depth: number; folderId: string | null }
  | { kind: "loose"; project: T; depth: 0 }
  | {
      kind: "folder";
      folder: ProjectFolder;
      depth: number;
      collapsed: boolean;
      /** Visible projects anywhere below, in display order, for counts and status. */
      projects: T[];
    };

/**
 * Groups come before projects at every level. Projects keep their order from the
 * sorted list; groups keep their stored order. A collapsed group hides its subtree.
 */
export function arrangeProjectFolderTree<
  T extends { group: { projectKey: string; isScratch?: boolean } },
>(
  projects: readonly T[],
  folders: readonly ProjectFolder[],
  options: { isCollapsed: (folderId: string) => boolean; includeEmpty?: boolean },
): ProjectFolderTreeRow<T>[] {
  const parents = resolveProjectFolderParents(folders);
  const owners = new Map<string, string>();
  for (const folder of folders) {
    for (const key of folder.projectKeys) if (!owners.has(key)) owners.set(key, folder.id);
  }
  const ownerOf = (project: T) => owners.get(project.group.projectKey) ?? null;
  const ordinary = projects.filter((project) => !project.group.isScratch);
  const descendants = new Map<string, T[]>();
  const collect = (folderId: string): T[] => {
    const known = descendants.get(folderId);
    if (known) return known;
    const below = [
      ...folders
        .filter((folder) => parents.get(folder.id) === folderId)
        .flatMap((folder) => collect(folder.id)),
      ...ordinary.filter((project) => ownerOf(project) === folderId),
    ];
    descendants.set(folderId, below);
    return below;
  };
  const rows: ProjectFolderTreeRow<T>[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of folders) {
      if ((parents.get(folder.id) ?? null) !== parentId) continue;
      const below = collect(folder.id);
      if (options.includeEmpty === false && below.length === 0) continue;
      const collapsed = options.isCollapsed(folder.id);
      rows.push({ kind: "folder", folder, depth, collapsed, projects: below });
      if (!collapsed) visit(folder.id, depth + 1);
    }
    for (const project of ordinary) {
      if (parentId === null && folders.length > 0) continue;
      if (ownerOf(project) === parentId)
        rows.push({ kind: "project", project, depth, folderId: parentId });
    }
  };
  visit(null, 0);
  const ungrouped = ordinary.filter((project) => ownerOf(project) === null);
  if (folders.length > 0 && ungrouped.length > 0) {
    const collapsed = options.isCollapsed(UNGROUPED_PROJECT_FOLDER_ID);
    rows.push({
      kind: "folder",
      folder: { id: UNGROUPED_PROJECT_FOLDER_ID, name: "Ungrouped", emoji: "", projectKeys: [] },
      depth: 0,
      collapsed,
      projects: ungrouped,
    });
    if (!collapsed)
      for (const project of ungrouped)
        rows.push({ kind: "project", project, depth: 1, folderId: null });
  }
  for (const project of projects)
    if (project.group.isScratch) rows.push({ kind: "loose", project, depth: 0 });
  return rows;
}

export type SidebarTreeDragItem = { kind: "folder"; id: string } | { kind: "project"; key: string };

export type SidebarTreeDropZone = "before" | "into" | "after";

export type SidebarTreeDropTarget =
  | { kind: "folder"; id: string; zone: SidebarTreeDropZone }
  | { kind: "project"; key: string; zone: "before" | "after" }
  | { kind: "root" };

export type SidebarTreeDrop =
  | { kind: "none" }
  | { kind: "move-folder"; folderId: string; to: ProjectFolderPlacement }
  | {
      kind: "move-project";
      projectKey: string;
      folderId: string | null;
      anchor?: { projectKey: string; position: "before" | "after" };
    };

/**
 * Where on a row a drop lands. Groups only sit among groups and projects among
 * projects, so a project over a group always drops into it and a group over a
 * project has no target.
 */
export function resolveSidebarTreeDropZone(
  dragged: SidebarTreeDragItem["kind"],
  row: { kind: "folder"; expanded: boolean } | { kind: "project" },
  fraction: number,
): SidebarTreeDropZone | null {
  if (row.kind === "project") {
    if (dragged === "folder") return null;
    return fraction < 0.5 ? "before" : "after";
  }
  if (dragged === "project") return "into";
  if (fraction < 0.25) return "before";
  if (fraction > 0.75 && !row.expanded) return "after";
  return "into";
}

export function planSidebarTreeDrop(
  folders: readonly ProjectFolder[],
  item: SidebarTreeDragItem,
  target: SidebarTreeDropTarget,
): SidebarTreeDrop {
  const none = { kind: "none" } as const;
  const parents = resolveProjectFolderParents(folders);
  if (item.kind === "folder") {
    if (
      item.id === UNGROUPED_PROJECT_FOLDER_ID ||
      (target.kind === "folder" && target.id === UNGROUPED_PROJECT_FOLDER_ID)
    )
      return none;
    if (target.kind === "project") return none;
    if (target.kind === "root")
      return parents.get(item.id) === null
        ? none
        : { kind: "move-folder", folderId: item.id, to: { parentId: null } };
    if (target.id === item.id || projectFolderAncestors(folders, target.id).includes(item.id))
      return none;
    if (target.zone === "into")
      return parents.get(item.id) === target.id
        ? none
        : { kind: "move-folder", folderId: item.id, to: { parentId: target.id } };
    return {
      kind: "move-folder",
      folderId: item.id,
      to: {
        parentId: parents.get(target.id) ?? null,
        ...(target.zone === "before" ? { before: target.id } : { after: target.id }),
      },
    };
  }
  const current = projectFolderOfProject(folders, item.key)?.id ?? null;
  if (target.kind === "root")
    return current === null ? none : { kind: "move-project", projectKey: item.key, folderId: null };
  if (target.kind === "folder") {
    const folderId = target.id === UNGROUPED_PROJECT_FOLDER_ID ? null : target.id;
    return current === folderId ? none : { kind: "move-project", projectKey: item.key, folderId };
  }
  if (target.key === item.key) return none;
  return {
    kind: "move-project",
    projectKey: item.key,
    folderId: projectFolderOfProject(folders, target.key)?.id ?? null,
    anchor: { projectKey: target.key, position: target.zone },
  };
}

/** Moves ids next to the first anchor id present; unknown moved ids join there too. */
export function placeProjectOrder(
  order: readonly string[],
  moved: readonly string[],
  anchors: readonly string[],
  position: "before" | "after",
): string[] {
  const movedSet = new Set(moved);
  const anchorSet = new Set(anchors);
  const rest = order.filter((id) => !movedSet.has(id));
  const first = rest.findIndex((id) => anchorSet.has(id));
  if (first < 0) return [...order];
  let last = first;
  while (last + 1 < rest.length && anchorSet.has(rest[last + 1]!)) last++;
  rest.splice(position === "before" ? first : last + 1, 0, ...moved);
  return rest;
}
