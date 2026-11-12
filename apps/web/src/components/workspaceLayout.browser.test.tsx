import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it keeps its first transform out of the timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { getRouter } from "~/router";
import { useThreadColumnsStore } from "~/threadColumnsStore";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));
// The desktop shell is what turns title bars into window drag regions.
vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));

const threadA = threadWithHistory("layout-a", 2);
const threadB = threadWithHistory("layout-b", 2);
const refA = { environmentId: ENVIRONMENT_ID, threadId: threadA.id };
const refB = { environmentId: ENVIRONMENT_ID, threadId: threadB.id };

const INTERACTIVE =
  'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="separator"]';

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Electron builds the window's drag shape from every element whose app region is drag or no-drag,
 * in document order, each one adding or cutting its box. Returns the controls a click on would
 * start a window drag instead.
 */
function controlsUnderDragRegions(): string[] {
  const regions: Array<{ drag: boolean; rect: DOMRect }> = [];
  for (const element of document.querySelectorAll<HTMLElement>("body *")) {
    const region = getComputedStyle(element).getPropertyValue("-webkit-app-region");
    if (region !== "drag" && region !== "no-drag") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    regions.push({ drag: region === "drag", rect });
  }
  const dragsAt = (x: number, y: number) => {
    let drag = false;
    for (const region of regions) {
      const { left, right, top, bottom } = region.rect;
      if (x >= left && x < right && y >= top && y < bottom) drag = region.drag;
    }
    return drag;
  };
  const blocked: string[] = [];
  for (const control of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || control.closest('[inert], [aria-hidden="true"]'))
      continue;
    // The rail straddles the sidebar edge: its outer half lies under the main title bar, which
    // comes later in the document. Its sidebar half stays grabbable.
    if (control.dataset.sidebar === "rail") continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    const inset = Math.min(2, rect.width / 4, rect.height / 4);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
    ] as const;
    if (points.some(([x, y]) => dragsAt(x, y))) {
      blocked.push(
        control.getAttribute("aria-label") ||
          control.textContent?.trim() ||
          control.outerHTML.slice(0, 160),
      );
    }
  }
  return blocked;
}

function intersect(a: Rect, b: Rect): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom && b.top < a.bottom;
}

function clip(rect: Rect, to: Rect): Rect | null {
  const clipped = {
    left: Math.max(rect.left, to.left),
    right: Math.min(rect.right, to.right),
    top: Math.max(rect.top, to.top),
    bottom: Math.min(rect.bottom, to.bottom),
  };
  return clipped.right - clipped.left > 0.5 ? clipped : null;
}

/** The visible box of each pane: the sidebar, each split column, and each column's inline panel. */
function paneBoxes() {
  const strip = document
    .querySelector<HTMLElement>("[data-thread-columns]")!
    .getBoundingClientRect();
  const panes: Array<{ name: string; rect: Rect; column?: string }> = [];
  const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
  const sidebarRect = sidebar?.getBoundingClientRect();
  if (sidebarRect && sidebarRect.right > 0 && sidebarRect.width > 0) {
    panes.push({ name: "sidebar", rect: sidebarRect });
  }
  for (const column of document.querySelectorAll<HTMLElement>("[data-thread-column-id]")) {
    const id = column.dataset.threadColumnId!;
    const rect = clip(column.getBoundingClientRect(), strip);
    if (rect) panes.push({ name: `column ${column.ariaLabel}`, rect, column: id });
    const panel = column.querySelector<HTMLElement>('[data-preview-panel-mode="inline"]');
    const panelRect = panel ? clip(panel.getBoundingClientRect(), strip) : null;
    if (panelRect && panelRect.right - panelRect.left > 1) {
      panes.push({ name: `panel of ${column.ariaLabel}`, rect: panelRect, column: id });
    }
  }
  return panes;
}

function overlappingPanes(): string[] {
  const panes = paneBoxes();
  const overlaps: string[] = [];
  for (const [index, a] of panes.entries()) {
    for (const b of panes.slice(index + 1)) {
      // A panel sits inside its own column; it must not reach any other pane.
      if (a.column !== undefined && a.column === b.column) continue;
      if (intersect(a.rect, b.rect)) overlaps.push(`${a.name} × ${b.name}`);
    }
  }
  return overlaps;
}

async function mountApp(width: number, height: number) {
  const environment = installFakeEnvironment([threadA, threadB]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const previousColumns = useThreadColumnsStore.getState();
  const previousPanels = useRightPanelStore.getState();
  useThreadColumnsStore.setState({ columns: [], activeId: null });
  // Sidebar visibility and pane widths persist; each test starts from the defaults.
  localStorage.clear();
  await page.viewport(width, height);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threadA.id}`] }),
  );
  await router.load();
  const screen = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("layout-a: question 0")).toBeVisible();
  return {
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      useThreadColumnsStore.setState(previousColumns);
      useRightPanelStore.setState(previousPanels);
      environment[Symbol.dispose]();
      localStorage.clear();
    },
  };
}

const rightPanelOpen = (ref: typeof refA) =>
  useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.isOpen ===
  true;

it("keeps the single-column title bar controls clickable and inset like the sidebar toggle", async () => {
  await using _app = await mountApp(1600, 900);
  expect(controlsUnderDragRegions()).toEqual([]);
  const toggleRect = document
    .querySelector<HTMLElement>("[data-right-panel-toggle]")!
    .getBoundingClientRect();
  expect(window.innerWidth - toggleRect.right).toBeGreaterThanOrEqual(10);
  expect(toggleRect.height).toBeGreaterThanOrEqual(28);
  const sidebarRect = page
    .getByRole("button", { name: "Toggle main sidebar" })
    .element()
    .getBoundingClientRect();
  // One line across the window: both clusters share the title bar's vertical centre.
  expect(
    Math.abs(toggleRect.top + toggleRect.height / 2 - (sidebarRect.top + sidebarRect.height / 2)),
  ).toBeLessThanOrEqual(1);
});

it("keeps the open panel's header controls and its add menu clickable", async () => {
  await using _app = await mountApp(1600, 900);
  await page.getByRole("button", { name: "Toggle right panel" }).click();
  await expect.element(page.getByRole("button", { name: "Close panel" })).toBeVisible();
  expect(controlsUnderDragRegions()).toEqual([]);
  await page.getByRole("button", { name: "Add panel surface" }).click();
  await expect.element(page.getByRole("menuitem", { name: /^Terminal/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("menuitem", { name: /^Terminal/ })).not.toBeInTheDocument();
  // The Escape that closed the menu does not also close the panel.
  expect(rightPanelOpen(refA)).toBe(true);
});

it("keeps split column and collapsed-sidebar title bars clickable", async () => {
  await using _app = await mountApp(1600, 900);
  await act(() => useThreadColumnsStore.getState().open(refB));
  const closeColumn = page.getByRole("button", { name: "Close column: Thread layout-b" });
  await expect.element(closeColumn).toBeVisible();
  expect(controlsUnderDragRegions()).toEqual([]);
  await page.getByRole("button", { name: "Toggle main sidebar" }).click();
  await expect
    .poll(() =>
      document.querySelector('[data-slot="sidebar-wrapper"]')?.getAttribute("data-sidebar-state"),
    )
    .toBe("collapsed");
  expect(controlsUnderDragRegions()).toEqual([]);
});

it("closes the empty panel with its ×, with Escape, and with the toggle that opened it", async () => {
  await using _app = await mountApp(1600, 900);
  const toggle = page.getByRole("button", { name: "Toggle right panel" });

  await toggle.click();
  await expect.element(page.getByText("Open a surface", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  expect(rightPanelOpen(refA)).toBe(false);

  await toggle.click();
  await expect.element(page.getByText("Open a surface", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(rightPanelOpen(refA)).toBe(false);

  await toggle.click();
  expect(rightPanelOpen(refA)).toBe(true);
  await toggle.click();
  expect(rightPanelOpen(refA)).toBe(false);

  // Closing the last surface tab closes the panel instead of leaving the picker behind.
  await act(() => useRightPanelStore.getState().open(refA, "diff"));
  const surface =
    useRightPanelStore.getState().byThreadKey[`${ENVIRONMENT_ID}:${threadA.id}`]!.surfaces[0]!;
  await act(() => useRightPanelStore.getState().closeSurface(refA, surface.id));
  expect(rightPanelOpen(refA)).toBe(false);
});

it("gives way in order as the window narrows: panel width, then the panel, then the sidebar", async () => {
  await using _app = await mountApp(1600, 900);
  await act(() => useRightPanelStore.getState().open(refA, "diff"));
  const chatWidth = () =>
    document.querySelector<HTMLElement>("[data-chat-column]")!.getBoundingClientRect().width;
  const inlinePanel = () =>
    document.querySelector<HTMLElement>('[data-preview-panel-mode="inline"]');

  await page.viewport(1300, 800);
  await expect
    .poll(() => inlinePanel()?.getBoundingClientRect().width ?? 0)
    .toBeGreaterThanOrEqual(360);
  expect(chatWidth()).toBeGreaterThanOrEqual(480);
  expect(overlappingPanes()).toEqual([]);

  // Too narrow for both: the panel becomes a drawer over the chat, the sidebar stays.
  await page.viewport(1000, 700);
  await expect
    .poll(() => document.querySelector('[data-preview-panel-mode="sheet"]'))
    .not.toBeNull();
  expect(inlinePanel()).toBeNull();
  expect(chatWidth()).toBeGreaterThanOrEqual(480);
  expect(
    document.querySelector<HTMLElement>('[data-slot="sidebar-container"]')!.getBoundingClientRect()
      .width,
  ).toBeGreaterThan(0);

  // Narrower still: the sidebar becomes an overlay its toggle brings back.
  await page.viewport(700, 500);
  await expect
    .poll(() =>
      document.querySelector('[data-slot="sidebar-wrapper"]')?.getAttribute("data-sidebar-state"),
    )
    .toBe("collapsed");
  // The open drawer is modal, so the toggle is found by its slot rather than its role.
  await expect
    .element(page.elementLocator(document.querySelector("[data-sidebar-control] button")!))
    .toBeVisible();
});

it("an empty picker the window squeezes into a drawer closes", async () => {
  await using _app = await mountApp(1600, 900);
  await page.getByRole("button", { name: "Toggle right panel" }).click();
  await expect.element(page.getByText("Open a surface", { exact: true })).toBeVisible();
  await page.viewport(1000, 700);
  await expect.poll(() => rightPanelOpen(refA)).toBe(false);
});

it.each([1600, 1300, 1000])(
  "sidebar, two split columns and the panel never overlap at %ipx",
  async (width) => {
    await using _app = await mountApp(1600, 900);
    await act(() => useThreadColumnsStore.getState().open(refB));
    await act(() =>
      useThreadColumnsStore.getState().activate(useThreadColumnsStore.getState().columns[0]!.id),
    );
    await act(() => useRightPanelStore.getState().open(refA, "diff"));
    await expect.element(page.getByText("layout-b: question 0")).toBeVisible();
    await page.viewport(width, 800);
    const strip = () =>
      document.querySelector<HTMLElement>("[data-thread-columns]")!.getBoundingClientRect();
    const active = () =>
      document.querySelector<HTMLElement>("[data-active-thread-column]")!.getBoundingClientRect();
    // The focused column, with its panel, is scrolled fully into view.
    await expect.poll(() => active().left - strip().left).toBeGreaterThanOrEqual(-1);
    expect(active().right).toBeLessThanOrEqual(strip().right + 1);
    expect(overlappingPanes()).toEqual([]);
    for (const column of document.querySelectorAll<HTMLElement>("[data-thread-column-id]")) {
      expect(column.getBoundingClientRect().width).toBeGreaterThanOrEqual(480);
    }
    const drawer = document.querySelector<HTMLElement>('[data-preview-panel-mode="sheet"]');
    if (width >= 1300) {
      expect(drawer).toBeNull();
      expect(document.querySelector('[data-preview-panel-mode="inline"]')).not.toBeNull();
    } else {
      // No room for chat and panel side by side: the column takes the strip, the panel a drawer
      // inside that column's box.
      expect(drawer).not.toBeNull();
      const box = drawer!.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(active().left);
      expect(box.right).toBeLessThanOrEqual(active().right + 1);
    }
    expect(controlsUnderDragRegions()).toEqual([]);
    const closePanel = page
      .getByRole("button", { name: "Close panel" })
      .element()
      .getBoundingClientRect();
    expect(closePanel.right).toBeLessThanOrEqual(active().right);
  },
);
