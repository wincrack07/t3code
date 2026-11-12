import { showContextMenuFallback } from "../contextMenuFallback";
import { openCommandPalette } from "../commandPaletteBus";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { getRouter } from "~/router";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render, stubGlobal } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it("opens the sidebar and header thread menus and offers a new window", async () => {
  await page.viewport(1400, 900);
  const thread = threadWithHistory("window-menu", 1);
  using _environment = installFakeEnvironment([thread]);
  const newWindow = vi.fn(async () => {});
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  // AppRoot supplies the router.
  await using screen = await render(<AppRoot router={router} />, { router: false });
  await expect
    .element(page.getByRole("button", { name: `Thread actions for Thread ${thread.id}` }))
    .toBeVisible();
  using _bridge = stubGlobal("desktopBridge", {
    newWindow,
    showContextMenu: showContextMenuFallback,
    getLocalEnvironmentEnabled: () => true,
    getLocalEnvironmentBootstraps: () => [],
    onQuitShortcut: () => () => {},
    onMenuAction: () => () => {},
    onNotificationBadgeClear: () => () => {},
    onTrackpadScrollBegin: () => () => {},
    onTrackpadScrollEnd: () => () => {},
  });
  await page.getByRole("button", { name: `Thread actions for Thread ${thread.id}` }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Open in new window", exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("menuitem", { name: "Open in new window", exact: true }));
  await vi.waitFor(() =>
    expect(newWindow).toHaveBeenCalledWith({ environmentId: ENVIRONMENT_ID, threadId: thread.id }),
  );
  await expect
    .element(page.getByText(`Thread ${thread.id}`, { exact: true }).first())
    .toBeVisible();
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector(`[data-thread-item="${ENVIRONMENT_ID}:${thread.id}"]`),
    ).not.toBeNull(),
  );
  await act(() => {
    const row = screen.container.querySelector(
      `[data-thread-item="${ENVIRONMENT_ID}:${thread.id}"]`,
    );
    if (!row) throw new Error("Missing sidebar thread");
    (row.querySelector("[data-sidebar-row]") ?? row).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 200 }),
    );
  });
  await expect
    .element(page.getByRole("menuitem", { name: "Open in new window", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  openCommandPalette({});
  await expect
    .element(page.getByRole("option", { name: /^Open thread in new window/ }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
});
