import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { sidebarFolderExpansionKeys } from "../Sidebar.logic";
import { setAllProjectsExpanded } from "./projectExpansion";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { ChevronsDownUpIcon, ChevronsUpDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { useClientSettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuTrigger,
  MenuPopup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../ui/menu";

export function SidebarDisplayMenu({
  projects = [],
  activeProjectKey = null,
  onCreateGroup,
  onSuggestGroups,
}: {
  projects?: readonly SidebarProjectSnapshot[];
  activeProjectKey?: string | null;
  onCreateGroup?: () => void;
  onSuggestGroups?: () => void;
}) {
  const expanded = useUiStateStore((state) => state.projectExpandedById);
  const folders = useClientSettings((settings) => settings.sidebarProjectFolders);
  const allCollapsed = projects
    .filter((project) => project.projectKey !== activeProjectKey)
    .every((project) => !resolveProjectExpanded(expanded, sidebarFolderExpansionKeys(project)));
  const setAll = (open: boolean) => {
    setAllProjectsExpanded(projects, open, activeProjectKey, folders);
  };
  const label = allCollapsed ? "Expand all projects" : "Collapse all projects";
  const density = useClientSettings((settings) => settings.sidebarDensity);
  const grouping = useClientSettings((settings) => settings.sidebarThreadGrouping);
  const update = useUpdatePrimarySettings();
  return (
    <>
      {projects.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={label}
                onClick={() => setAll(allCollapsed)}
              />
            }
          >
            {allCollapsed ? (
              <ChevronsUpDownIcon className="size-4" />
            ) : (
              <ChevronsDownUpIcon className="size-4" />
            )}
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
      ) : null}
      <Menu>
        <MenuTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Sidebar display" />}
        >
          <SlidersHorizontalIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {projects.length > 0 ? (
            <>
              <MenuItem onClick={() => setAll(false)}>Collapse all projects</MenuItem>
              <MenuItem onClick={() => setAll(true)}>Expand all projects</MenuItem>
            </>
          ) : null}
          {onCreateGroup ? <MenuItem onClick={onCreateGroup}>New project group…</MenuItem> : null}
          {onSuggestGroups ? <MenuItem onClick={onSuggestGroups}>Suggest groups</MenuItem> : null}
          <MenuSeparator />
          <MenuRadioGroup
            value={density}
            onValueChange={(value) => {
              if (value === "theme" || value === "compact" || value === "comfortable")
                update({ sidebarDensity: value });
            }}
          >
            <MenuGroupLabel>Thread density</MenuGroupLabel>
            <MenuRadioItem value="theme">Theme default</MenuRadioItem>
            <MenuRadioItem value="compact">Compact</MenuRadioItem>
            <MenuRadioItem value="comfortable">Comfortable</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuRadioGroup
            value={grouping}
            onValueChange={(value) => {
              if (value === "theme" || value === "project" || value === "global")
                update({ sidebarThreadGrouping: value });
            }}
          >
            <MenuGroupLabel>Thread grouping</MenuGroupLabel>
            <MenuRadioItem value="theme">Theme default</MenuRadioItem>
            <MenuRadioItem value="project">All threads by project</MenuRadioItem>
            <MenuRadioItem value="global">Global settled section</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </>
  );
}
