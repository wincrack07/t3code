import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

const backup = (project: string) =>
  JSON.stringify({
    format: "t3code.thread",
    version: 1,
    threadId: `source-${project}`,
    title: `${project} chat`,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    source: { environmentId: "source-machine", label: "Source machine" },
    project: { title: project, workspacePath: `/original/${project}` },
    provider: "devReplay",
    model: "showcase",
    conversation: [
      {
        role: "user",
        text: `Notes for ${project}`,
        timestamp: "2026-11-01T00:00:00Z",
        attachments: [],
      },
    ],
  });

test(
  "Importing into a machine without matching projects preserves separate project folders",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const temporary = await t3.project("Installer", {
      "ERP.t3thread.json": backup("ERP"),
      "Website.t3thread.json": backup("Website"),
    });
    await t3.open("/settings/fork/chats");
    await browser
      .locator('input[type="file"][accept=".t3thread.json,.zip"]')
      .setInputFiles([`${temporary}/ERP.t3thread.json`, `${temporary}/Website.t3thread.json`]);
    await app.screenshot("import-projects");
    const review = screen.getByRole("dialog", "Import chats");
    await expect(review).toBeVisible();
    await expect(review.getByText("Source project · /original/ERP · 1 chat")).toBeVisible();
    await review.getByRole("button", "Next", { exact: true }).tap();
    await screen.getByLabel("Projects folder").fill(`${temporary}/restored`);
    await expect(screen.getByText(`${temporary}/restored/ERP`, { exact: true })).toBeVisible();
    await expect(screen.getByText(`${temporary}/restored/Website`, { exact: true })).toBeVisible();
    await review.getByRole("button", "Next", { exact: true }).tap();
    await review.getByRole("button", "Import chats", { exact: true }).tap();
    await expect(screen.getByText("Imported 2", { exact: true })).toBeVisible({ timeout: 60_000 });
    await app.screenshot("import-complete");
  },
);
