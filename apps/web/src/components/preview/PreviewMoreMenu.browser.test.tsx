import type { BrowserExtension } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PreviewMoreMenu, type PreviewMoreMenuActions } from "./PreviewMoreMenu";

const extension = (overrides: Partial<BrowserExtension>): BrowserExtension => ({
  id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
  name: "1Password",
  version: "8.12.0",
  source: "webStore",
  enabled: true,
  hasPopup: true,
  ...overrides,
});

it("lists enabled extension popups when the menu opens and opens the chosen one", async () => {
  const openExtensionPopup = vi.fn();
  const actions: PreviewMoreMenuActions = {
    hardReload: vi.fn(),
    setColorScheme: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    clearCookies: vi.fn(),
    clearCache: vi.fn(),
    listExtensions: async () => [
      extension({}),
      extension({ id: "disabled", name: "Disabled one", enabled: false }),
      extension({ id: "nopopup", name: "Content only", hasPopup: false }),
    ],
    openExtensionPopup,
  };
  await using _screen = await render(
    <PreviewMoreMenu
      enabled
      actions={actions}
      zoomFactor={1}
      colorScheme="system"
      deviceToolbarVisible={false}
      onToggleDeviceToolbar={vi.fn()}
      nativePictureInPicture={false}
      profileName="Default"
    />,
  );

  await userEvent.click(page.getByRole("button", { name: "Preview menu" }));
  await expect.element(page.getByText("Extensions")).toBeVisible();
  await expect.element(page.getByText("Disabled one")).not.toBeInTheDocument();
  await expect.element(page.getByText("Content only")).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("menuitem", { name: "1Password" }));
  expect(openExtensionPopup).toHaveBeenCalledWith("aeblfdkhhhdcdjpifhhbdiojplfjncoa");
});
