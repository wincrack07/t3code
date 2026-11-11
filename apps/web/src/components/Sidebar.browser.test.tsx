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
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

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
