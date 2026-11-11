import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { ProjectFolder } from "../../projectFolders";
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
      ...folders.map((folder) => `project-group:${folder.id}`),
    ],
    expanded,
  );
  if (!expanded && activeProjectKey !== null) {
    const active = projects.find((project) => project.projectKey === activeProjectKey);
    if (active) store.setProjectExpanded(sidebarFolderExpansionKeys(active), true);
    const parent = folders.find((folder) => folder.projectKeys.includes(activeProjectKey));
    if (parent) store.setProjectExpanded(`project-group:${parent.id}`, true);
  }
}
