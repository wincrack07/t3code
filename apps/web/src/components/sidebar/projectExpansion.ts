import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  projectFolderAncestors,
  UNGROUPED_PROJECT_FOLDER_ID,
  projectFolderExpansionKey,
  projectFolderOfProject,
  type ProjectFolder,
} from "../../projectFolders";
import { sidebarFolderExpansionKeys } from "../Sidebar.logic";
import { useUiStateStore } from "../../uiStateStore";

export function setAllProjectsExpanded(
  projects: readonly SidebarProjectSnapshot[],
  expanded: boolean,
  activeProjectKey: string | null = null,
  folders: readonly ProjectFolder[] = [],
) {
  const store = useUiStateStore.getState();
  store.setProjectExpanded(
    [
      ...projects.flatMap(sidebarFolderExpansionKeys),
      projectFolderExpansionKey(UNGROUPED_PROJECT_FOLDER_ID),
      ...folders.map((folder) => projectFolderExpansionKey(folder.id)),
    ],
    expanded,
  );
  if (!expanded && activeProjectKey !== null) {
    const active = projects.find((project) => project.projectKey === activeProjectKey);
    if (active) store.setProjectExpanded(sidebarFolderExpansionKeys(active), true);
    const parent = projectFolderOfProject(folders, activeProjectKey);
    if (!parent && folders.length > 0)
      store.setProjectExpanded(projectFolderExpansionKey(UNGROUPED_PROJECT_FOLDER_ID), true);
    if (parent)
      store.setProjectExpanded(
        [parent.id, ...projectFolderAncestors(folders, parent.id)].map(projectFolderExpansionKey),
        true,
      );
  }
}
