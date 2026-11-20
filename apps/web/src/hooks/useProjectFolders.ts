import type { ProjectFolder } from "../projectFolders";
import { useForkFeature } from "../state/forkFeatures";
import { useClientSettings } from "./useSettings";

const NO_FOLDERS: ReadonlyArray<ProjectFolder> = [];
const withoutColors = new WeakMap<ReadonlyArray<ProjectFolder>, ReadonlyArray<ProjectFolder>>();

/**
 * The sidebar's project groups as the fork switches allow them: none while project groups are
 * off, and uncoloured while sidebar colours are off. Writers read the saved setting instead, so
 * switching a feature off never erases groups or colours.
 */
export function useProjectFolders(): ReadonlyArray<ProjectFolder> {
  const groupsOn = useForkFeature("projectGroups");
  const colorsOn = useForkFeature("sidebarColors");
  const saved = useClientSettings((settings) => settings.sidebarProjectFolders);
  if (!groupsOn) return NO_FOLDERS;
  if (colorsOn) return saved;
  let plain = withoutColors.get(saved);
  if (!plain) {
    plain = saved.map(({ sidebarColor: _color, ...folder }) => folder);
    withoutColors.set(saved, plain);
  }
  return plain;
}

/** "Hide project icons" belongs to the fork's sidebar layout; off, icons show as upstream. */
export function useHideSidebarProjectIcons(): boolean {
  const layoutOn = useForkFeature("sidebarLayout");
  return useClientSettings((settings) => settings.hideSidebarProjectIcons) && layoutOn;
}
