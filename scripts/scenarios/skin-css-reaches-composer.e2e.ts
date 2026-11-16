/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

const skin = JSON.stringify({
  version: 1,
  name: "Nebula compatibility",
  appearance: "dark",
  colors: { canvas: "#0b060d", accent: "#d1458f" },
  css: `
    [data-chat-canvas] { background: radial-gradient(ellipse at center, #352469, #0b060d) !important; }
    [data-workspace-area="conversation"], .messages-timeline-scroll { background: transparent !important; }
    [data-slot="composer-host"] { background: rgba(22, 12, 24, .62) !important; }
    [data-slot="composer-host"]::after { border-color: rgb(190, 60, 200); }
  `,
});

test(
  "Imported skin CSS reaches the composer without opaque surfaces covering it",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const project = await t3.project("Skin compatibility", { "skin.json": skin });
    const thread = await t3.thread({
      project,
      title: "Skin compatibility",
      messages: ["Check the skin"],
    });
    await t3.open(thread);
    await screen.getByRole("button", "Settings", { exact: true }).tap();
    await screen.getByRole("button", "Appearance", { exact: true }).tap();
    await screen.getByRole("button", "Dark", { exact: true }).tap();
    await screen.getByRole("button", "Add theme", { exact: true }).tap();
    await browser
      .locator('input[type="file"][accept=".json,application/json"]')
      .setInputFiles(`${project}/skin.json`);
    await screen
      .getByRole("dialog", "Add a theme")
      .getByRole("button", "Add theme", { exact: true })
      .tap();
    await screen
      .getByRole("dialog", "Settings", { exact: true })
      .getByRole("button", "Close", { exact: true })
      .tap();
    await expect(browser.locator('[data-slot="composer-host"]')).toBeVisible();
    await app.screenshot("skin-composer");
    const surfaces = await browser.evaluate(() => ({
      lane: getComputedStyle(document.querySelector(".chat-composer-lane")!).backgroundColor,
      surface: getComputedStyle(document.querySelector("[data-chat-composer-surface]")!)
        .backgroundColor,
      mainBorder: getComputedStyle(document.querySelector("[data-chat-composer-main-surface]")!)
        .borderTopColor,
      edge: getComputedStyle(document.querySelector('[data-slot="composer-host"]')!, "::after")
        .display,
    }));
    expect(surfaces).toEqual({
      lane: "rgba(0, 0, 0, 0)",
      surface: "rgba(0, 0, 0, 0)",
      edge: "block",
      mainBorder: "rgba(0, 0, 0, 0)",
    });
  },
);
