import { describe, expect, it } from "vite-plus/test";

import { movedSettingsPath, searchSettings, SETTINGS_SEARCH_ITEMS } from "../settingsSearch";
import { FORK_SETTINGS_PATHS, FORK_SETTINGS_SEARCH_ITEMS } from "./forkSettings";

describe("fork settings", () => {
  it("lists every fork setting once, on a fork page", () => {
    for (const item of FORK_SETTINGS_SEARCH_ITEMS) {
      expect(SETTINGS_SEARCH_ITEMS.filter((candidate) => candidate.id === item.id)).toHaveLength(1);
      expect(FORK_SETTINGS_PATHS).toContain(item.to);
    }
    expect(searchSettings("keep awake")[0]).toMatchObject({
      id: "keep-awake",
      to: "/settings/fork/machine",
      scope: "environment-defaults",
    });
  });

  it("sends old links to the fork pages", () => {
    expect(movedSettingsPath("/settings/pr-reviews", "")).toBe("/settings/fork/pr-reviews");
    expect(movedSettingsPath("/settings/monitor", "system-monitor")).toBe("/settings/fork/monitor");
    expect(movedSettingsPath("/settings/labs", "decisions")).toBe("/settings/fork/composer");
    expect(movedSettingsPath("/settings/maintenance", "keep-awake")).toBe("/settings/fork/machine");
    expect(movedSettingsPath("/settings/connections", "peer-link-mesh")).toBe(
      "/settings/fork/connections",
    );
    expect(movedSettingsPath("/settings/labs", "")).toBeNull();
    expect(movedSettingsPath("/settings/threads", "text-generation-model")).toBeNull();
  });
});
