import { useProjectSidebarColor } from "../hooks/useProjectSidebarColor";
import "../index.css";
import { useUiStateStore } from "../uiStateStore";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { installFakeEnvironment, type FakeDriver } from "../../test/fakeEnvironment";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";
import type { Project } from "../types";
import type { ProjectFolder } from "../projectFolders";
import Sidebar from "./Sidebar";
import { Sidebar as SidebarShell, SidebarProvider } from "./ui/sidebar";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useProjectSidebarColor", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using _environment = installFakeEnvironment([]);
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

it("hides grouped project children on collapse, expands all, and opens project actions", async () => {
  const setColor = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useProjectSidebarColor).mockImplementation(() => ({
    canSet: () => true,
    setColor,
    colorFor: () => null,
  }));
  using _environment = installFakeEnvironment([]);
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  const previousUi = useUiStateStore.getState();
  stack.defer(() => {
    vi.mocked(useProjectSidebarColor).mockRestore();
    __setClientSettingsForTests(previousSettings);
    useUiStateStore.setState(previousUi);
  });
  const projects = [project("StaffPass: Backend"), project("StaffPass: Website")];
  const groups = buildSidebarProjectSnapshots({
    projects,
    settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: projects[0]!.environmentId,
    resolveEnvironmentLabel: () => null,
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarThreadGrouping: "project",
    sidebarProjectGroupingMode: "separate",
    sidebarProjectFolders: [
      {
        id: "staff",
        name: "StaffPass",
        emoji: "📁",
        projectKeys: groups.map((group) => group.projectKey),
      },
    ],
  });
  useUiStateStore.setState({ projectExpandedById: {} });
  vi.mocked(useProjects).mockReturnValue(projects);
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef: null,
  });
  await using screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  const folders = () => screen.container.querySelectorAll('[data-testid="sidebar-project-folder"]');
  await vi.waitFor(() => expect(folders()).toHaveLength(2));
  await userEvent.click(screen.getByRole("button", { name: "Collapse all projects", exact: true }));
  await vi.waitFor(() => expect(folders()).toHaveLength(0));
  await userEvent.click(screen.getByRole("button", { name: "Expand all projects", exact: true }));
  await vi.waitFor(() => expect(folders()).toHaveLength(2));
  await act(() => {
    folders()[0]!
      .querySelector("button")!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 200,
        }),
      );
  });
  await userEvent.hover(page.getByRole("menuitem", { name: "Sidebar colour", exact: true }));
  await expect.element(page.getByRole("menuitem", { name: "Blue", exact: true })).toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Blue", exact: true }));
  expect(setColor).toHaveBeenCalledWith(groups[0]!.memberProjects, "#629bd7");
  await act(() => {
    folders()[0]!
      .querySelector("button")!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 200,
        }),
      );
  });
  await expect
    .element(page.getByRole("menuitem", { name: "Move to group", exact: true }))
    .toBeVisible();
  await userEvent.hover(page.getByRole("menuitem", { name: "Move to group", exact: true }));
  await expect
    .element(page.getByRole("menuitem", { name: "New group…", exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "New group…", exact: true }));
  await userEvent.fill(page.getByRole("textbox", { name: "Group name", exact: true }), "Services");
  await userEvent.click(page.getByRole("button", { name: "Save group", exact: true }));
  await expect
    .element(screen.getByRole("button", { name: "Group actions for Services", exact: true }))
    .toBeVisible();
  expect(
    getClientSettings().sidebarProjectFolders.find((folder) => folder.name === "Services")
      ?.projectKeys,
  ).toEqual([groups[0]!.projectKey]);
});

// Mounted in the app's sidebar shell so rows have real widths for pointer hit testing.
function GroupedSidebar() {
  return (
    <SidebarProvider>
      <SidebarShell side="left" collapsible="offcanvas">
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarShell>
    </SidebarProvider>
  );
}

async function setupGroupedSidebar(
  titles: readonly string[],
  folders: (projectKeys: readonly string[]) => ProjectFolder[],
) {
  const stack = new DisposableStack();
  const previousSettings = getClientSettings();
  const previousUi = useUiStateStore.getState();
  stack.defer(() => {
    __setClientSettingsForTests(previousSettings);
    useUiStateStore.setState(previousUi);
  });
  const projects = titles.map(project);
  const projectKeys = buildSidebarProjectSnapshots({
    projects,
    settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: projects[0]!.environmentId,
    resolveEnvironmentLabel: () => null,
  }).map((group) => group.projectKey);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarThreadGrouping: "project",
    sidebarProjectGroupingMode: "separate",
    sidebarProjectFolders: folders(projectKeys),
  });
  useUiStateStore.setState({ projectExpandedById: {} });
  // The default viewport clips the lower rows behind the sidebar footer.
  await page.viewport(1280, 900);
  vi.mocked(useProjects).mockReturnValue(projects);
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef: null,
  });
  return { stack, projectKeys };
}

function treeRows(container: Element) {
  return [...container.querySelectorAll<HTMLElement>("[data-tree-row]")].map(
    (row) => row.dataset.treeRow,
  );
}

function folderById(id: string) {
  return getClientSettings().sidebarProjectFolders.find((folder) => folder.id === id);
}

async function openProjectMenu(container: Element, projectKey: string) {
  const row = container.querySelector(`[data-tree-row="project:${CSS.escape(projectKey)}"]`)!;
  await act(() => {
    row.querySelector("button")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 200,
      }),
    );
  });
}

async function pointerDrag(source: Element, target: Element) {
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const pointer = (type: string, x: number, y: number, buttons: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    });
  const startX = from.left + 12;
  const startY = from.top + from.height / 2;
  const endX = to.left + 24;
  const endY = to.top + to.height / 2;
  await act(() => source.dispatchEvent(pointer("pointerdown", startX, startY, 1)));
  await act(() => document.dispatchEvent(pointer("pointermove", startX, startY + 16, 1)));
  await act(() => document.dispatchEvent(pointer("pointermove", endX, endY, 1)));
  await expect.poll(() => target.getAttribute("data-tree-drop")).toBe("into");
  await act(() => document.dispatchEvent(pointer("pointerup", endX, endY, 0)));
}

it("nests groups and moves projects through the group and project menus", async () => {
  const { stack, projectKeys } = await setupGroupedSidebar(["Alpha", "Beta"], ([alpha, beta]) => [
    { id: "clau", name: "Clau", emoji: "", projectKeys: [alpha!] },
    { id: "staff", name: "StaffPass", emoji: "", projectKeys: [beta!] },
    { id: "backend", name: "Backend", emoji: "", projectKeys: [] },
  ]);
  using _settings = stack;
  using _environment = installFakeEnvironment([]);
  const [alpha, beta] = projectKeys as [string, string];
  await using screen = await render(<GroupedSidebar />);
  await vi.waitFor(() =>
    expect(treeRows(screen.container)).toEqual([
      "folder:clau",
      `project:${alpha}`,
      "folder:staff",
      `project:${beta}`,
      "folder:backend",
    ]),
  );

  await userEvent.click(screen.getByRole("button", { name: "Group actions for Backend" }));
  await userEvent.hover(page.getByRole("menuitem", { name: "Move to group", exact: true }));
  await userEvent.click(page.getByRole("menuitem", { name: "Clau", exact: true }));
  await vi.waitFor(() => expect(folderById("backend")?.parentId).toBe("clau"));
  await vi.waitFor(() =>
    expect(treeRows(screen.container)).toEqual([
      "folder:clau",
      "folder:backend",
      `project:${alpha}`,
      "folder:staff",
      `project:${beta}`,
    ]),
  );

  await openProjectMenu(screen.container, beta);
  await userEvent.hover(page.getByRole("menuitem", { name: "Move to group", exact: true }));
  await userEvent.click(page.getByRole("menuitem", { name: "Clau / Backend", exact: true }));
  await vi.waitFor(() => expect(folderById("backend")?.projectKeys).toEqual([beta]));
  expect(folderById("staff")?.projectKeys).toEqual([]);

  await openProjectMenu(screen.container, beta);
  await userEvent.click(page.getByRole("menuitem", { name: "Move to top level", exact: true }));
  await vi.waitFor(() => expect(folderById("backend")?.projectKeys).toEqual([]));

  await userEvent.click(screen.getByRole("button", { name: "Group actions for Backend" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Move to top level", exact: true }));
  await vi.waitFor(() => expect(folderById("backend")).not.toHaveProperty("parentId"));

  await userEvent.click(screen.getByRole("button", { name: "Group actions for Clau" }));
  await userEvent.click(page.getByRole("menuitem", { name: "New group inside…", exact: true }));
  await userEvent.fill(page.getByRole("textbox", { name: "Group name", exact: true }), "Nested");
  await userEvent.click(page.getByRole("button", { name: "Save group", exact: true }));
  await vi.waitFor(() =>
    expect(
      getClientSettings().sidebarProjectFolders.find((folder) => folder.name === "Nested")
        ?.parentId,
    ).toBe("clau"),
  );

  await userEvent.click(screen.getByRole("button", { name: "Group actions for Clau" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Delete group", exact: true }));
  await vi.waitFor(() => expect(folderById("clau")).toBeUndefined());
  const nested = getClientSettings().sidebarProjectFolders.find(
    (folder) => folder.name === "Nested",
  );
  expect(nested).not.toHaveProperty("parentId");
  expect(getClientSettings().sidebarProjectFolders.flatMap((folder) => folder.projectKeys)).toEqual(
    [],
  );
});

it("drags a project into a group and a group into a group", async () => {
  const { stack, projectKeys } = await setupGroupedSidebar(["Alpha", "Beta"], ([alpha, beta]) => [
    { id: "clau", name: "Clau", emoji: "", projectKeys: [alpha!] },
    { id: "staff", name: "StaffPass", emoji: "", projectKeys: [beta!] },
  ]);
  using _settings = stack;
  using _environment = installFakeEnvironment([]);
  const [alpha, beta] = projectKeys as [string, string];
  await using screen = await render(<GroupedSidebar />);
  const row = (value: string) =>
    screen.container.querySelector(`[data-tree-row="${CSS.escape(value)}"]`)!;
  await vi.waitFor(() =>
    expect(treeRows(screen.container)).toEqual([
      "folder:clau",
      `project:${alpha}`,
      "folder:staff",
      `project:${beta}`,
    ]),
  );

  await pointerDrag(row(`project:${beta}`).querySelector("button")!, row("folder:clau"));
  await vi.waitFor(() => expect(folderById("clau")?.projectKeys).toEqual([alpha, beta]));
  await vi.waitFor(() =>
    expect(treeRows(screen.container)).toEqual([
      "folder:clau",
      `project:${alpha}`,
      `project:${beta}`,
      "folder:staff",
    ]),
  );

  await pointerDrag(row("folder:staff").querySelector("button")!, row("folder:clau"));
  await vi.waitFor(() => expect(folderById("staff")?.parentId).toBe("clau"));
  await vi.waitFor(() =>
    expect(treeRows(screen.container)).toEqual([
      "folder:clau",
      "folder:staff",
      `project:${alpha}`,
      `project:${beta}`,
    ]),
  );
});
