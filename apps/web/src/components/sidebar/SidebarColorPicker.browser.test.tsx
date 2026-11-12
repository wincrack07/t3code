import type * as Context from "effect/Context";
import { installFakeEnvironment, type FakeDriver } from "../../../test/fakeEnvironment";
import "../../index.css";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { SidebarColorPicker } from "./SidebarColorPicker";
import { ProjectGroupHeader } from "./ProjectGroupHeader";
import { ProjectFolderEditor } from "./ProjectFolderEditor";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

it("opens the project colour picker, chooses a palette colour and applies a custom colour", async () => {
  using _environment = installFakeEnvironment([]);
  const onChange = vi.fn();
  await using screen = await render(<SidebarColorPicker value={null} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "Sidebar colour", exact: true }));
  await expect
    .element(page.getByRole("menuitemradio", { name: "Default", exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("menuitemradio", { name: "Blue", exact: true }));
  expect(onChange).toHaveBeenCalledWith("#629bd7");
  await userEvent.click(page.getByRole("textbox", { name: "Custom sidebar colour" }));
  const custom = page.getByRole("textbox", { name: "Custom sidebar colour" });
  await userEvent.fill(custom, "#oops");
  await expect.element(custom).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  expect(onChange).toHaveBeenLastCalledWith("#629bd7");
  await userEvent.fill(custom, "#112233");
  await userEvent.keyboard("{Enter}");
  expect(onChange).toHaveBeenLastCalledWith("#112233");
  await userEvent.fill(custom, "#445566");
  await userEvent.click(page.getByRole("button", { name: "Apply", exact: true }));
  expect(onChange).toHaveBeenLastCalledWith("#445566");
});

it("opens group colour actions and its edit-dialog colour menu", async () => {
  using _environment = installFakeEnvironment([]);
  using stack = new DisposableStack();
  const old = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(old));
  const folder = {
    id: "staff",
    name: "StaffPass",
    emoji: "",
    projectKeys: [],
    sidebarColor: "#629bd7",
  };
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, sidebarProjectFolders: [folder] });
  await using screen = await render(
    <>
      <ul>
        <ProjectGroupHeader
          folder={folder}
          folders={[folder]}
          excludedFolderIds={new Set([folder.id])}
          onCreateInside={vi.fn()}
          onMove={vi.fn()}
          collapsed
          threads={[]}
          onToggle={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />
      </ul>
      <ProjectFolderEditor folder={folder} onClose={vi.fn()} />
    </>,
  );
  await userEvent.click(page.getByRole("button", { name: "Sidebar colour", exact: true }));
  await expect
    .element(page.getByRole("menuitemradio", { name: "Blue", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Escape}");
  await screen.rerender(
    <ul>
      <ProjectGroupHeader
        folder={folder}
        folders={[folder]}
        excludedFolderIds={new Set([folder.id])}
        onCreateInside={vi.fn()}
        onMove={vi.fn()}
        collapsed
        threads={[]}
        onToggle={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    </ul>,
  );
  await act(() => {
    screen.container
      .querySelector("[data-sidebar-row]")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await userEvent.hover(page.getByRole("menuitem", { name: "Sidebar colour", exact: true }));
  await expect
    .element(page.getByRole("menuitemradio", { name: "Default", exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("menuitemradio", { name: "Default", exact: true }));
  await vi.waitFor(() =>
    expect(getClientSettings().sidebarProjectFolders[0]?.sidebarColor).toBeNull(),
  );
});
