import type { CSSProperties } from "react";
import "../../index.css";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { installFakeEnvironment, type FakeDriver } from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { usePullRequestsSupported } from "../../state/environments";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
  SidebarMenuItem,
} from "../ui/sidebar";
import { SidebarChromeFooter } from "./SidebarChrome";

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
vi.mock("../../state/environments", { spy: true });
vi.mock("./SidebarProviderUpdatePill", () => ({ SidebarProviderUpdatePill: () => null }));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => (
    <SidebarMenuItem className="ml-auto shrink-0">
      <button type="button" aria-label="Refresh" className="size-8">
        ↻
      </button>
    </SidebarMenuItem>
  ),
}));

it("pins the footer at 500px tall, fits narrow widths, opens More, and restores after collapse", async () => {
  using _environment = installFakeEnvironment([]);
  using stack = new DisposableStack();
  const previous = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previous));
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, showSystemMonitor: false });
  vi.mocked(usePullRequestsSupported).mockReturnValue(true);
  await page.viewport(900, 500);
  const layout = (width: number) => (
    <SidebarProvider
      defaultOpen
      storageKey="footer-layout-test"
      style={{ "--sidebar-width": `${width}px`, height: "100dvh", minHeight: 0 } as CSSProperties}
    >
      <Sidebar collapsible="offcanvas">
        <div className="h-16 shrink-0">Projects</div>
        <SidebarContent>
          <div className="h-[2000px]">Many project and settled rows</div>
        </SidebarContent>
        <SidebarChromeFooter />
      </Sidebar>
      <div className="fixed right-2 top-2 z-50">
        <SidebarTrigger />
      </div>
    </SidebarProvider>
  );
  await using screen = await render(layout(320));
  const footer = () => screen.container.querySelector<HTMLElement>('[data-sidebar="footer"]')!;
  const assertBounds = () => {
    const sidebar = screen.container
      .querySelector<HTMLElement>('[data-slot="sidebar-inner"]')!
      .getBoundingClientRect();
    const bounds = footer().getBoundingClientRect();
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(bounds.bottom).toBeGreaterThanOrEqual(window.innerHeight - 1);
    expect(bounds.height).toBeGreaterThan(32);
    const viewport = screen.container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )!;
    expect(viewport.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.top);
    expect(viewport.clientHeight).toBeGreaterThan(0);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    for (const button of footer().querySelectorAll("button")) {
      if (!button.checkVisibility()) continue;
      const rect = button.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(sidebar.left);
      expect(rect.right).toBeLessThanOrEqual(sidebar.right);
      expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    }
  };
  await vi.waitFor(assertBounds);
  await page.viewport(900, 350);
  await vi.waitFor(assertBounds);
  await page.viewport(900, 500);
  await screen.rerender(layout(208));
  await vi.waitFor(assertBounds);
  await expect.element(screen.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Machine monitor", exact: true }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Keep awake:/ })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "More sidebar actions" }));
  await expect
    .element(page.getByRole("menuitem", { name: "Pull requests", exact: true }))
    .toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Usage", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("menuitem", { name: "Artifacts", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!.inert).toBe(true),
  );
  await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
  await vi.waitFor(assertBounds);
});
