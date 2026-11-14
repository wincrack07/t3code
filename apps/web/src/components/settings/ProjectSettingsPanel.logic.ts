import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
} from "@t3tools/client-runtime/state/project-grouping";
import type { ClientSettings, ProjectIconOverride } from "@t3tools/contracts";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { Project } from "../../types";

export const SCRATCH_PROJECT_TITLE = "No project";
const SCRATCH_PROJECT_ICON = {
  kind: "lucide",
  name: "message-square-dashed",
  color: "gray",
} as const satisfies ProjectIconOverride;

export function scopeProjectSettingsGroup(
  group: SidebarProjectSnapshot,
  members: readonly SidebarProjectGroupMember[],
): SidebarProjectSnapshot {
  const representative =
    members.find(
      (member) => member.environmentId === group.environmentId && member.id === group.id,
    ) ?? members[0]!;
  return { ...group, ...representative, memberProjects: members };
}

export function projectGroupTitleNeedsUpdate(
  members: ReadonlyArray<Pick<Project, "title" | "hasCustomTitle">>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return (
    wasEdited &&
    members.some((member) => member.title !== nextTitle || member.hasCustomTitle !== true)
  );
}

export function defaultProjectIcon(project: Pick<Project, "isScratch">) {
  return { faviconPath: null, projectIcon: project.isScratch ? SCRATCH_PROJECT_ICON : null };
}

export function hasDefaultProjectIcon(
  project: Pick<Project, "isScratch" | "faviconPath" | "projectIcon">,
): boolean {
  if (project.faviconPath != null) return false;
  const icon = project.projectIcon ?? null;
  if (!project.isScratch) return icon === null;
  return (
    icon?.kind === "lucide" &&
    icon.name === SCRATCH_PROJECT_ICON.name &&
    icon.color === SCRATCH_PROJECT_ICON.color
  );
}

export function findProjectSettingsSuccessor(
  groups: readonly SidebarProjectSnapshot[],
  members: readonly Pick<
    SidebarProjectGroupMember,
    "environmentId" | "id" | "physicalProjectKey"
  >[],
) {
  return groups.find((group) =>
    group.memberProjects.some((member) =>
      members.some(
        (previous) => previous.environmentId === member.environmentId && previous.id === member.id,
      ),
    ),
  );
}

export function movedProjectClientSettings(
  current: ClientSettings,
  project: Project,
  workspaceRoot: string,
): ClientSettings {
  const moved = { ...project, workspaceRoot };
  const before = derivePhysicalProjectKey(project);
  const after = derivePhysicalProjectKey(moved);
  if (before === after) return current;
  const overrides = { ...current.sidebarProjectGroupingOverrides };
  if (overrides[before] !== undefined) {
    overrides[after] = overrides[before];
    delete overrides[before];
  }
  const settings = { ...current, sidebarProjectGroupingOverrides: overrides };
  const oldGroup = deriveLogicalProjectKeyFromSettings(project, current);
  const newGroup = deriveLogicalProjectKeyFromSettings(moved, settings);
  return {
    ...settings,
    sidebarProjectFolders: current.sidebarProjectFolders.map((folder) => ({
      ...folder,
      projectKeys: [
        ...new Set(folder.projectKeys.map((key) => (key === oldGroup ? newGroup : key))),
      ],
    })),
  };
}
