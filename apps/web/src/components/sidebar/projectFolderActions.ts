import { getProjectOrderKey } from "@t3tools/client-runtime/state/project-grouping";
import type { ClientSettings } from "@t3tools/contracts";
import { persistClientSettingsUpdate } from "../../hooks/useSettings";
import {
  deleteProjectFolder,
  moveProjectFolder,
  moveProjectsToFolder,
  placeProjectOrder,
  type ProjectFolderPlacement,
  type SidebarTreeDrop,
} from "../../projectFolders";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { stackedThreadToast, toastManager } from "../ui/toast";

function saveFolders(update: (current: ClientSettings) => Partial<ClientSettings>) {
  void persistClientSettingsUpdate((current) => ({ ...current, ...update(current) })).catch(
    (error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not save project groups",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  );
}

/** The one path for menus, drag and settings to change a project's sidebar group. */
export function moveSidebarProjectToFolder(projectKey: string, folderId: string | null) {
  saveFolders((current) => ({
    sidebarProjectFolders: moveProjectsToFolder(
      current.sidebarProjectFolders,
      [projectKey],
      folderId,
    ),
  }));
}

export function moveSidebarFolder(folderId: string, to: ProjectFolderPlacement) {
  saveFolders((current) => ({
    sidebarProjectFolders: moveProjectFolder(current.sidebarProjectFolders, folderId, to),
  }));
}

export function deleteSidebarFolder(folderId: string) {
  saveFolders((current) => ({
    sidebarProjectFolders: deleteProjectFolder(current.sidebarProjectFolders, folderId),
  }));
}

/**
 * `projects` is every project in its current sidebar order. Reordering a project
 * pins that order by switching the sidebar to manual project order.
 */
export function applySidebarTreeDrop(
  drop: SidebarTreeDrop,
  projects: readonly SidebarProjectSnapshot[],
) {
  if (drop.kind === "move-folder") return moveSidebarFolder(drop.folderId, drop.to);
  if (drop.kind !== "move-project") return;
  const { anchor } = drop;
  const orderKeysOf = (projectKey: string) =>
    projects
      .find((project) => project.projectKey === projectKey)
      ?.memberProjects.map(getProjectOrderKey) ?? [];
  if (anchor) {
    useUiStateStore.setState({
      projectOrder: placeProjectOrder(
        projects.flatMap((project) => project.memberProjects.map(getProjectOrderKey)),
        orderKeysOf(drop.projectKey),
        orderKeysOf(anchor.projectKey),
        anchor.position,
      ),
    });
  }
  saveFolders((current) => ({
    sidebarProjectFolders: moveProjectsToFolder(
      current.sidebarProjectFolders,
      [drop.projectKey],
      drop.folderId,
    ),
    ...(anchor ? { sidebarProjectSortOrder: "manual" as const } : {}),
  }));
}
