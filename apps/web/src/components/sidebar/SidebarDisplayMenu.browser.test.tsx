import "../../index.css";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { SidebarDisplayMenu } from "./SidebarDisplayMenu";
import { ProjectFolderMenu } from "./ProjectFolderMenu";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { Menu, MenuTrigger, MenuPopup } from "../ui/menu";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { sidebarFolderExpansionKeys } from "../Sidebar.logic";

function setup() {
  const stack = new DisposableStack();
  const settings = getClientSettings();
  const ui = useUiStateStore.getState();
  stack.defer(() => {
    __setClientSettingsForTests(settings);
    useUiStateStore.setState(ui);
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarProjectFolders: [
      { id: "staff", name: "StaffPass", emoji: "", projectKeys: ["active", "idle"] },
    ],
  });
  useUiStateStore.setState({ projectExpandedById: {} });
  return stack;
}

it("opens the display menu and collapses all projects while preserving the current project", async () => {
  using _fixture = setup();
  const projects = buildSidebarProjectSnapshots({
    projects: ["active", "idle"].map((id) => ({
      id: ProjectId.make(id),
      environmentId: EnvironmentId.make("local"),
      title: id,
      workspaceRoot: `/projects/${id}`,
      repositoryIdentity: null,
      defaultModelSelection: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scripts: [],
    })),
    settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: EnvironmentId.make("local"),
    resolveEnvironmentLabel: () => null,
  });
  const onCreate = vi.fn();
  await using screen = await render(
    <SidebarDisplayMenu
      projects={projects}
      activeProjectKey={projects[0]!.projectKey}
      onCreateGroup={onCreate}
      onSuggestGroups={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Sidebar display" }));
  await expect
    .element(page.getByRole("menuitemradio", { name: "Compact", exact: true }))
    .toBeVisible();
  await expect.element(page.getByText("Thread grouping", { exact: true })).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Collapse all projects", exact: true }));
  expect(
    resolveProjectExpanded(
      useUiStateStore.getState().projectExpandedById,
      sidebarFolderExpansionKeys(projects[0]!),
    ),
  ).toBe(true);
  expect(
    resolveProjectExpanded(
      useUiStateStore.getState().projectExpandedById,
      sidebarFolderExpansionKeys(projects[1]!),
    ),
  ).toBe(false);
  await expect
    .element(page.getByRole("menuitem", { name: "Collapse all projects", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Expand all projects", exact: true }));
  expect(
    resolveProjectExpanded(
      useUiStateStore.getState().projectExpandedById,
      sidebarFolderExpansionKeys(projects[1]!),
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Sidebar display" }));
  await userEvent.click(page.getByRole("menuitem", { name: "New project group…" }));
  expect(onCreate).toHaveBeenCalledOnce();
});

it("opens group actions and the move-to-group submenu", async () => {
  using _fixture = setup();
  const folder = getClientSettings().sidebarProjectFolders[0]!;
  const child = { id: "child", name: "Backend", emoji: "", projectKeys: [], parentId: "staff" };
  const other = { id: "other", name: "Other", emoji: "", projectKeys: [] };
  const folders = [folder, child, other];
  const onMove = vi.fn();
  const onGroupMove = vi.fn();
  const onRename = vi.fn();
  const onCreateInside = vi.fn();
  await using screen = await render(
    <>
      <ul>
        <ProjectGroupHeader
          folder={folder}
          folders={folders}
          excludedFolderIds={new Set(["staff", "child"])}
          collapsed
          threads={[]}
          onToggle={vi.fn()}
          onRename={onRename}
          onCreateInside={onCreateInside}
          onMove={onGroupMove}
          onDelete={vi.fn()}
        />
        <ProjectGroupHeader
          folder={child}
          folders={folders}
          depth={1}
          parentId="staff"
          excludedFolderIds={new Set(["child"])}
          collapsed
          threads={[]}
          onToggle={vi.fn()}
          onRename={vi.fn()}
          onCreateInside={vi.fn()}
          onMove={onGroupMove}
          onDelete={vi.fn()}
        />
      </ul>
      <Menu>
        <MenuTrigger>Project actions</MenuTrigger>
        <MenuPopup>
          <ProjectFolderMenu
            folders={[folder, other]}
            currentFolderId="staff"
            onMove={onMove}
            onCreate={vi.fn()}
          />
        </MenuPopup>
      </Menu>
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Group actions for StaffPass" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Rename group" }));
  expect(onRename).toHaveBeenCalledOnce();
  await expect
    .element(page.getByRole("menuitem", { name: "Rename group", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Group actions for StaffPass" }));
  await userEvent.click(page.getByRole("menuitem", { name: "New group inside…" }));
  expect(onCreateInside).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Group actions for StaffPass" }));
  await expect
    .element(page.getByRole("menuitem", { name: "Move to top level", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.hover(page.getByRole("menuitem", { name: "Move to group", exact: true }));
  // A group never offers itself or its own subgroups as a destination.
  await expect.element(page.getByRole("menuitem", { name: "Other", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("menuitem", { name: "Backend", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(page.getByRole("menuitem", { name: "Other", exact: true }));
  expect(onGroupMove).toHaveBeenLastCalledWith("other");
  await userEvent.click(screen.getByRole("button", { name: "Group actions for Backend" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Move to top level", exact: true }));
  expect(onGroupMove).toHaveBeenLastCalledWith(null);
  await userEvent.click(screen.getByRole("button", { name: "Project actions" }));
  await userEvent.hover(page.getByRole("menuitem", { name: "Move to group" }));
  await expect
    .element(page.getByRole("menuitem", { name: "StaffPass", exact: true }))
    .toBeDisabled();
  await userEvent.click(page.getByRole("menuitem", { name: "Other", exact: true }));
  expect(onMove).toHaveBeenCalledExactlyOnceWith("other");
  await userEvent.click(screen.getByRole("button", { name: "Project actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Move to top level", exact: true }));
  expect(onMove).toHaveBeenLastCalledWith(null);
});
